import { readFile } from "node:fs/promises";

import { activeWorkflowData } from "./active-data.js";
import { matchAutoReplyEscalationRule } from "./auto-reply-rules.js";
import { normalizeSampleRecord, parseSampleJsonl } from "./intake.js";
import { createDefaultLlmClient, readLlmConfigFromEnv, type LlmClient } from "./llm/client.js";
import {
  generateAutoReplyWithLlm,
  generateClassificationWithLlm,
  generateFaqCandidatesWithLlm,
  generateWeeklyReportWithLlm,
} from "./llm/generation.js";
import { createAdminNotification, createAutoReplyEscalationNotification } from "./notifications.js";
import { buildWeeklyReportMetrics } from "./report.js";
import { listByCreatedAt, listByIngestedAt, type Phase1State } from "./store.js";
import { newId, nowIso } from "./ids.js";
import {
  type AdminFeedback,
  type AutoReply,
  type FeedbackKind,
  type FaqCandidateStatus,
  type LlmGenerationRun,
  type Message,
  type LlmTaskType,
  type WeeklyReport,
} from "../shared/types.js";

export const sampleLogPath = "datasets/samples/discord-jp-v0.jsonl";

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const workers = Array.from({ length: Math.max(1, concurrency) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < items.length; index += Math.max(1, concurrency)) {
      const item = items[index];
      if (item !== undefined) {
        await fn(item);
      }
    }
  });
  await Promise.all(workers);
}

function hasMessage(state: Phase1State, message: Message): boolean {
  return [...state.messages.values()].some(
    (existing) =>
      existing.source === message.source &&
      existing.guildId === message.guildId &&
      existing.messageId === message.messageId,
  );
}

function hasNotificationForMessage(state: Phase1State, messageId: string): boolean {
  return [...state.notifications.values()].some((notification) =>
    notification.messageIds.includes(messageId),
  );
}

function saveLlmRun(state: Phase1State, run: LlmGenerationRun | null): void {
  if (run !== null) {
    state.llmGenerationRuns.set(run.id, run);
  }
}

export function ingestMessage(state: Phase1State, message: Message): Message {
  if (hasMessage(state, message)) {
    const existing = [...state.messages.values()].find(
      (candidate) =>
        candidate.source === message.source &&
        candidate.guildId === message.guildId &&
        candidate.messageId === message.messageId,
    );
    if (existing !== undefined) {
      return existing;
    }
  }

  state.messages.set(message.id, message);
  state.queuedJobs.push({
    queueName: "message.classify",
    payload: { messageId: message.id },
  });
  return message;
}

export async function processMessage(
  state: Phase1State,
  message: Message,
  client: LlmClient = createDefaultLlmClient(),
): Promise<void> {
  if (message.deletedAt !== null) {
    return;
  }
  const classificationResult = await generateClassificationWithLlm(message, client);
  saveLlmRun(state, classificationResult.run);
  const { classification } = classificationResult;
  if (classification === null) {
    return;
  }
  state.classifications.set(classification.id, classification);

  const notification = createAdminNotification(message, classification, state.settings);
  if (notification !== null) {
    state.notifications.set(notification.id, notification);
  }

  const { autoReply, run } = await generateAutoReplyWithLlm(
    message,
    classification,
    state.autoReplyPolicy,
    activeWorkflowData(state).faqCandidates,
    client,
  );
  saveLlmRun(state, run);
  state.autoReplies.set(autoReply.id, autoReply);
  const matchedRule = matchAutoReplyEscalationRule(state.autoReplyPolicy.escalationRules, {
    message,
    classification,
    category: autoReply.replyCategory,
  });
  if (
    matchedRule?.rule.action === "notify_admin" &&
    !hasNotificationForMessage(state, message.id)
  ) {
    const escalationNotification = createAutoReplyEscalationNotification(
      message,
      classification,
      state.settings,
      matchedRule.reason,
    );
    state.notifications.set(escalationNotification.id, escalationNotification);
  }
}

export async function importSampleLog(
  state: Phase1State,
  path = sampleLogPath,
  client: LlmClient = createDefaultLlmClient(),
): Promise<{
  readonly imported: number;
  readonly skipped: number;
}> {
  const jsonl = await readFile(path, "utf8");
  const records = parseSampleJsonl(jsonl);
  let imported = 0;
  let skipped = 0;
  const ingestedMessages: Message[] = [];

  for (const [index, record] of records.entries()) {
    const message = normalizeSampleRecord(record, index);
    const before = state.messages.size;
    const ingested = ingestMessage(state, message);
    if (state.messages.size === before && ingested.id !== message.id) {
      skipped += 1;
      continue;
    }
    imported += 1;
    ingestedMessages.push(ingested);
  }

  await runWithConcurrency(ingestedMessages, readLlmConfigFromEnv().concurrency, async (message) =>
    processMessage(state, message, client),
  );

  return { imported, skipped };
}

export async function refreshFaqCandidates(
  state: Phase1State,
  client: LlmClient = createDefaultLlmClient(),
): Promise<void> {
  const active = activeWorkflowData(state);
  const { candidates, run } = await generateFaqCandidatesWithLlm(
    active.messages,
    active.classifications,
    client,
  );
  saveLlmRun(state, run);
  if (candidates !== null) {
    state.faqCandidates.clear();
    for (const candidate of candidates) {
      state.faqCandidates.set(candidate.id, candidate);
    }
  }
}

export async function generateWeeklyReport(
  state: Phase1State,
  periodStart: string,
  periodEnd: string,
  client: LlmClient = createDefaultLlmClient(),
): Promise<WeeklyReport | null> {
  await refreshFaqCandidates(state, client);
  const active = activeWorkflowData(state);
  const metrics = buildWeeklyReportMetrics(
    active.classifications,
    active.faqCandidates,
    active.autoReplies,
  );
  const { report, run } = await generateWeeklyReportWithLlm(client, {
    settings: state.settings,
    messages: active.messages,
    classifications: active.classifications,
    faqCandidates: active.faqCandidates,
    periodStart,
    periodEnd,
    metrics,
  });
  saveLlmRun(state, run);
  if (report !== null) {
    state.weeklyReports.set(report.id, report);
  }
  state.queuedJobs.push({
    queueName: "report.weekly",
    payload: {
      periodStart,
      periodEnd,
      channelIds: state.settings.targetChannelIds,
    },
  });
  return report;
}

export async function retryLlmRun(
  state: Phase1State,
  runId: string,
  client: LlmClient = createDefaultLlmClient(),
): Promise<void> {
  const run = state.llmGenerationRuns.get(runId);
  if (run === undefined) {
    throw new Error(`LLM run not found: ${runId}`);
  }
  await reprocessLlmTask(state, run.taskType, client, run.targetId);
}

export async function reprocessLlmTask(
  state: Phase1State,
  scope: LlmTaskType | "all",
  client: LlmClient = createDefaultLlmClient(),
  targetId?: string,
): Promise<void> {
  if (scope === "all" || scope === "classification") {
    const messages =
      targetId === undefined
        ? activeWorkflowData(state).messages
        : activeWorkflowData(state).messages.filter((message) => message.id === targetId);
    if (targetId === undefined) {
      state.classifications.clear();
      state.notifications.clear();
      state.autoReplies.clear();
    }
    for (const message of messages) {
      await processMessage(state, message, client);
    }
  }

  if (scope === "auto_reply") {
    const classificationsByMessage = new Map(
      [...state.classifications.values()].map((classification) => [
        classification.messageId,
        classification,
      ]),
    );
    const messages =
      targetId === undefined
        ? activeWorkflowData(state).messages
        : activeWorkflowData(state).messages.filter((message) => message.id === targetId);
    if (targetId === undefined) {
      state.autoReplies.clear();
    }
    for (const message of messages) {
      const classification = classificationsByMessage.get(message.id);
      if (classification !== undefined) {
        const { autoReply, run } = await generateAutoReplyWithLlm(
          message,
          classification,
          state.autoReplyPolicy,
          activeWorkflowData(state).faqCandidates,
          client,
        );
        saveLlmRun(state, run);
        state.autoReplies.set(autoReply.id, autoReply);
      }
    }
  }

  if (scope === "all" || scope === "faq_candidates") {
    await refreshFaqCandidates(state, client);
  }

  if (scope === "all" || scope === "weekly_report") {
    const [periodStart = "2026-01-01", periodEnd = "2026-01-07"] = (targetId ?? "").split(":");
    await generateWeeklyReport(state, periodStart, periodEnd, client);
  }
}

export function recordFeedback(
  state: Phase1State,
  targetType: AdminFeedback["targetType"],
  targetId: string,
  feedbackKind: FeedbackKind,
  note = "",
): AdminFeedback {
  const feedback: AdminFeedback = {
    id: newId(),
    targetType,
    targetId,
    feedbackKind,
    note,
    createdAt: nowIso(),
  };
  state.feedback.set(feedback.id, feedback);
  return feedback;
}

export function updateFaqCandidateStatus(
  state: Phase1State,
  candidateId: string,
  status: FaqCandidateStatus,
): void {
  const candidate = state.faqCandidates.get(candidateId);
  if (candidate === undefined) {
    throw new Error(`FAQ candidate not found: ${candidateId}`);
  }
  state.faqCandidates.set(candidateId, {
    ...candidate,
    status,
    updatedAt: nowIso(),
  });
}

export function approveAutoReply(
  state: Phase1State,
  autoReplyId: string,
  approvedBy: string,
): AutoReply {
  const reply = state.autoReplies.get(autoReplyId);
  if (reply === undefined) {
    throw new Error(`auto reply not found: ${autoReplyId}`);
  }
  const approved: AutoReply = {
    ...reply,
    status: "sent",
    sentMessageId: newId(),
    approvedBy,
    sentAt: nowIso(),
  };
  state.autoReplies.set(approved.id, approved);
  state.queuedJobs.push({
    queueName: "auto_reply.send",
    payload: { autoReplyId },
  });
  return approved;
}

export function rejectAutoReply(state: Phase1State, autoReplyId: string): AutoReply {
  const reply = state.autoReplies.get(autoReplyId);
  if (reply === undefined) {
    throw new Error(`auto reply not found: ${autoReplyId}`);
  }
  const rejected: AutoReply = {
    ...reply,
    status: "blocked",
    decisionReason: "管理者により却下されました。",
  };
  state.autoReplies.set(rejected.id, rejected);
  return rejected;
}

export function snapshot(state: Phase1State): Record<string, unknown> {
  return {
    settings: state.settings,
    autoReplyPolicy: state.autoReplyPolicy,
    messages: listByIngestedAt(state.messages.values()),
    classifications: listByCreatedAt(state.classifications.values()),
    notifications: listByCreatedAt(state.notifications.values()),
    autoReplies: listByCreatedAt(state.autoReplies.values()),
    faqCandidates: listByCreatedAt(state.faqCandidates.values()),
    weeklyReports: listByCreatedAt(state.weeklyReports.values()),
    llmGenerationRuns: listByCreatedAt(state.llmGenerationRuns.values()),
    feedback: listByCreatedAt(state.feedback.values()),
    queuedJobs: state.queuedJobs,
  };
}
