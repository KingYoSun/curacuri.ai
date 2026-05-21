import { readFile } from "node:fs/promises";

import { activeWorkflowData } from "./active-data.js";
import { normalizeDiscordEvent, normalizeSampleRecord, parseSampleJsonl } from "./intake.js";
import { matchAutoReplyEscalationRule } from "./auto-reply-rules.js";
import { newId, nowIso } from "./ids.js";
import { createDefaultLlmClient, type LlmClient } from "./llm/client.js";
import {
  generateAutoReplyWithLlm,
  generateClassificationWithLlm,
  generateFaqCandidatesWithLlm,
  generateWeeklyReportWithLlm,
} from "./llm/generation.js";
import { createAdminNotification, createAutoReplyEscalationNotification } from "./notifications.js";
import { buildWeeklyReportMetrics } from "./report.js";
import { sampleLogPath } from "./workflow.js";
import type { Phase1Repository } from "./repositories/types.js";
import type {
  AdminFeedback,
  AdminNotification,
  AutoReply,
  FeedbackKind,
  FaqCandidate,
  FaqCandidateStatus,
  LlmGenerationRun,
  LlmTaskType,
} from "../shared/types.js";
import type {
  AutoReplyDecidePayload,
  AutoReplySendPayload,
  DiscordIngestPayload,
  FaqGeneratePayload,
  MessageClassifyPayload,
  OpsNotifyPayload,
  QueueName,
  QueuePayload,
  ReportWeeklyPayload,
} from "../shared/queue.js";

export type QueuePublisher = {
  add(queueName: QueueName, payload: QueuePayload): Promise<{ readonly id: string | undefined }>;
};

export type RepositoryWorkflow = {
  readonly repository: Phase1Repository;
  readonly queues: QueuePublisher;
  readonly llmClient?: LlmClient;
};

function clientOrDefault(client: LlmClient | undefined): LlmClient {
  return client ?? createDefaultLlmClient();
}

function saveLlmRun(runMap: Map<string, LlmGenerationRun>, run: LlmGenerationRun | null): void {
  if (run !== null) {
    runMap.set(run.id, run);
  }
}

export async function sweepExpiredMessages(repository: Phase1Repository): Promise<number> {
  const settings = await repository.getSettings();
  return repository.logicalDeleteExpiredMessages(settings.retentionDays);
}

export async function enqueueSampleLog(
  repository: Phase1Repository,
  queues: QueuePublisher,
  path = sampleLogPath,
): Promise<{ readonly enqueued: number }> {
  await repository.ensureSeed();
  const jsonl = await readFile(path, "utf8");
  const records = parseSampleJsonl(jsonl);
  for (const [index, record] of records.entries()) {
    await queues.add("discord.ingest", { kind: "sample_record", record, index });
  }
  return { enqueued: records.length };
}

export async function handleDiscordIngest(
  context: RepositoryWorkflow,
  payload: DiscordIngestPayload,
): Promise<void> {
  const settings = await context.repository.getSettings();
  const message =
    payload.kind === "sample_record"
      ? normalizeSampleRecord(payload.record, payload.index)
      : normalizeDiscordEvent(payload.event);
  if (settings.excludedChannelIds.includes(message.channelId)) {
    return;
  }
  if (!settings.targetChannelIds.includes(message.channelId)) {
    return;
  }
  const result = await context.repository.upsertMessage(message);
  if (result.created) {
    await context.queues.add("message.classify", {
      messageId: result.message.id,
    } satisfies MessageClassifyPayload);
  }
}

export async function handleMessageClassify(
  context: RepositoryWorkflow,
  payload: MessageClassifyPayload,
): Promise<void> {
  await sweepExpiredMessages(context.repository);
  const state = await context.repository.loadState();
  const message = state.messages.get(payload.messageId);
  if (message?.deletedAt !== null) {
    return;
  }
  const classificationResult = await generateClassificationWithLlm(
    message,
    clientOrDefault(context.llmClient),
  );
  saveLlmRun(state.llmGenerationRuns, classificationResult.run);
  const { classification } = classificationResult;
  const followUpJobs: QueuePayload[] = [];
  if (classification !== null) {
    state.classifications.set(classification.id, classification);
    const notification = createAdminNotification(message, classification, state.settings);
    if (notification !== null) {
      state.notifications.set(notification.id, notification);
      followUpJobs.push({
        classificationId: classification.id,
        messageIds: [message.id],
      } satisfies OpsNotifyPayload);
    }
    followUpJobs.push({
      messageId: message.id,
      classificationId: classification.id,
    } satisfies AutoReplyDecidePayload);
  }
  await context.repository.saveState(state);
  for (const job of followUpJobs) {
    if ("classificationId" in job && "messageId" in job) {
      await context.queues.add("auto_reply.decide", job);
    } else {
      await context.queues.add("ops.notify", job);
    }
  }
}

function normalizePendingSend(reply: AutoReply): AutoReply {
  if (reply.status !== "sent") {
    return reply;
  }
  return {
    ...reply,
    status: "drafted",
    sentMessageId: null,
    sentAt: null,
  };
}

function hasNotificationForMessage(
  notifications: Iterable<AdminNotification>,
  messageId: string,
): boolean {
  return [...notifications].some((notification) => notification.messageIds.includes(messageId));
}

export async function handleAutoReplyDecide(
  context: RepositoryWorkflow,
  payload: AutoReplyDecidePayload,
): Promise<void> {
  await sweepExpiredMessages(context.repository);
  const state = await context.repository.loadState();
  const message = state.messages.get(payload.messageId);
  const classification = state.classifications.get(payload.classificationId);
  if (
    message === undefined ||
    classification === undefined ||
    message.deletedAt !== null ||
    classification.messageId !== message.id
  ) {
    return;
  }
  const autoReplyResult = await generateAutoReplyWithLlm(
    message,
    classification,
    state.autoReplyPolicy,
    activeWorkflowData(state).faqCandidates,
    clientOrDefault(context.llmClient),
  );
  saveLlmRun(state.llmGenerationRuns, autoReplyResult.run);
  const reply = normalizePendingSend(autoReplyResult.autoReply);
  state.autoReplies.set(reply.id, reply);
  const matchedRule = matchAutoReplyEscalationRule(state.autoReplyPolicy.escalationRules, {
    message,
    classification,
    category: reply.replyCategory,
  });
  let notifyJob: OpsNotifyPayload | null = null;
  if (
    matchedRule?.rule.action === "notify_admin" &&
    !hasNotificationForMessage(state.notifications.values(), message.id)
  ) {
    const notification = createAutoReplyEscalationNotification(
      message,
      classification,
      state.settings,
      matchedRule.reason,
    );
    state.notifications.set(notification.id, notification);
    notifyJob = {
      classificationId: classification.id,
      messageIds: [message.id],
    };
  }
  await context.repository.saveState(state);
  if (notifyJob !== null) {
    await context.queues.add("ops.notify", notifyJob);
  }
  if (reply.status === "drafted") {
    await context.queues.add("auto_reply.send", {
      autoReplyId: reply.id,
    } satisfies AutoReplySendPayload);
  }
}

export async function handleFaqGenerate(
  context: RepositoryWorkflow,
  _payload: FaqGeneratePayload = {},
): Promise<void> {
  void _payload;
  await sweepExpiredMessages(context.repository);
  const state = await context.repository.loadState();
  const active = activeWorkflowData(state);
  const { candidates, run } = await generateFaqCandidatesWithLlm(
    active.messages,
    active.classifications,
    clientOrDefault(context.llmClient),
  );
  saveLlmRun(state.llmGenerationRuns, run);
  if (candidates !== null) {
    state.faqCandidates.clear();
    for (const candidate of candidates) {
      state.faqCandidates.set(candidate.id, candidate);
    }
  }
  await context.repository.saveState(state);
}

export async function handleReportWeekly(
  context: RepositoryWorkflow,
  payload: ReportWeeklyPayload,
): Promise<void> {
  await sweepExpiredMessages(context.repository);
  const state = await context.repository.loadState();
  const activeBeforeFaq = activeWorkflowData(state);
  const faqGeneration = await generateFaqCandidatesWithLlm(
    activeBeforeFaq.messages,
    activeBeforeFaq.classifications,
    clientOrDefault(context.llmClient),
  );
  saveLlmRun(state.llmGenerationRuns, faqGeneration.run);
  if (faqGeneration.candidates !== null) {
    state.faqCandidates.clear();
    for (const candidate of faqGeneration.candidates) {
      state.faqCandidates.set(candidate.id, candidate);
    }
  }
  const active = activeWorkflowData(state);
  const metrics = buildWeeklyReportMetrics(
    active.classifications,
    active.faqCandidates,
    active.autoReplies,
  );
  const { report, run } = await generateWeeklyReportWithLlm(clientOrDefault(context.llmClient), {
    settings: state.settings,
    messages: active.messages,
    classifications: active.classifications,
    faqCandidates: active.faqCandidates,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    metrics,
  });
  saveLlmRun(state.llmGenerationRuns, run);
  if (report !== null) {
    state.weeklyReports.set(report.id, report);
  }
  await context.repository.saveState(state);
}

export async function enqueueRetryRun(
  repository: Phase1Repository,
  queues: QueuePublisher,
  runId: string,
): Promise<void> {
  const run = await repository.getLlmRun(runId);
  if (run === null) {
    throw new Error(`LLM run not found: ${runId}`);
  }
  await enqueueReprocess(repository, queues, run.taskType, run.targetId);
}

export async function enqueueReprocess(
  repository: Phase1Repository,
  queues: QueuePublisher,
  scope: LlmTaskType | "all",
  targetId?: string,
): Promise<void> {
  if (scope === "all" || scope === "classification") {
    const messages =
      targetId === undefined
        ? await repository.listMessages()
        : [await repository.getMessage(targetId)].filter((message) => message !== null);
    for (const message of messages) {
      await queues.add("message.classify", {
        messageId: message.id,
      } satisfies MessageClassifyPayload);
    }
  }
  if (scope === "auto_reply") {
    const messages =
      targetId === undefined
        ? await repository.listMessages()
        : [await repository.getMessage(targetId)].filter((message) => message !== null);
    for (const message of messages) {
      const classification = await repository.findClassificationByMessageId(message.id);
      if (classification !== null) {
        await queues.add("auto_reply.decide", {
          messageId: message.id,
          classificationId: classification.id,
        } satisfies AutoReplyDecidePayload);
      }
    }
  }
  if (scope === "all" || scope === "faq_candidates") {
    await queues.add("faq.generate", {} satisfies FaqGeneratePayload);
  }
  if (scope === "all" || scope === "weekly_report") {
    const [periodStart = "2026-01-01", periodEnd = "2026-01-07"] = (targetId ?? "").split(":");
    const settings = await repository.getSettings();
    await queues.add("report.weekly", {
      periodStart,
      periodEnd,
      channelIds: settings.targetChannelIds,
    } satisfies ReportWeeklyPayload);
  }
}

export async function approveAutoReplyInRepository(
  repository: Phase1Repository,
  queues: QueuePublisher,
  autoReplyId: string,
  approvedBy: string,
): Promise<AutoReply> {
  const reply = await repository.getAutoReply(autoReplyId);
  if (reply === null) {
    throw new Error(`auto reply not found: ${autoReplyId}`);
  }
  const approved: AutoReply = {
    ...reply,
    status: "drafted",
    approvedBy,
    sentMessageId: null,
    sentAt: null,
  };
  await repository.updateAutoReply(approved);
  await queues.add("auto_reply.send", { autoReplyId } satisfies AutoReplySendPayload);
  return approved;
}

export async function rejectAutoReplyInRepository(
  repository: Phase1Repository,
  autoReplyId: string,
): Promise<AutoReply> {
  const reply = await repository.getAutoReply(autoReplyId);
  if (reply === null) {
    throw new Error(`auto reply not found: ${autoReplyId}`);
  }
  const rejected: AutoReply = {
    ...reply,
    status: "blocked",
    decisionReason: "管理者により却下されました。",
  };
  await repository.updateAutoReply(rejected);
  return rejected;
}

export async function recordFeedbackInRepository(
  repository: Phase1Repository,
  targetType: AdminFeedback["targetType"],
  targetId: string,
  feedbackKind: FeedbackKind,
  note = "",
): Promise<AdminFeedback> {
  const feedback: AdminFeedback = {
    id: newId(),
    targetType,
    targetId,
    feedbackKind,
    note,
    createdAt: nowIso(),
  };
  await repository.saveFeedback(feedback);
  return feedback;
}

export async function dismissNotificationInRepository(
  repository: Phase1Repository,
  notificationId: string,
): Promise<AdminNotification> {
  const notification = await repository.getNotification(notificationId);
  if (notification === null) {
    throw new Error(`notification not found: ${notificationId}`);
  }
  await repository.dismissNotification(notificationId);
  return {
    ...notification,
    status: "dismissed",
    failureReason: null,
  };
}

export async function updateFaqCandidateStatusInRepository(
  repository: Phase1Repository,
  candidateId: string,
  status: FaqCandidateStatus,
): Promise<void> {
  const candidate = await repository.getFaqCandidate(candidateId);
  if (candidate === null) {
    throw new Error(`FAQ candidate not found: ${candidateId}`);
  }
  await repository.updateFaqCandidateStatus(candidateId, status);
}

export async function updateFaqCandidateInRepository(
  repository: Phase1Repository,
  candidateId: string,
  patch: Partial<Pick<FaqCandidate, "topic" | "draftQuestion" | "draftAnswer" | "status">>,
): Promise<FaqCandidate> {
  const candidate = await repository.getFaqCandidate(candidateId);
  if (candidate === null) {
    throw new Error(`FAQ candidate not found: ${candidateId}`);
  }
  return repository.updateFaqCandidate({
    ...candidate,
    ...patch,
    updatedAt: nowIso(),
  });
}
