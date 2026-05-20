import { readFile } from "node:fs/promises";

import { classifyMessage } from "./classifier.js";
import { decideAutoReply } from "./auto-reply.js";
import { generateFaqCandidates } from "./faq.js";
import { normalizeSampleRecord, parseSampleJsonl } from "./intake.js";
import { createAdminNotification } from "./notifications.js";
import { buildWeeklyReport } from "./report.js";
import { listByCreatedAt, listByIngestedAt, type Phase1State } from "./store.js";
import { newId, nowIso } from "./ids.js";
import {
  type AdminFeedback,
  type AutoReply,
  type FeedbackKind,
  type FaqCandidateStatus,
  type Message,
  type WeeklyReport,
} from "../shared/types.js";

export const sampleLogPath = "datasets/samples/discord-jp-v0.jsonl";

function hasMessage(state: Phase1State, message: Message): boolean {
  return [...state.messages.values()].some(
    (existing) =>
      existing.source === message.source &&
      existing.guildId === message.guildId &&
      existing.messageId === message.messageId,
  );
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

export function processMessage(state: Phase1State, message: Message): void {
  const classification = classifyMessage(message);
  state.classifications.set(classification.id, classification);

  const notification = createAdminNotification(message, classification, state.settings);
  if (notification !== null) {
    state.notifications.set(notification.id, notification);
  }

  const autoReply = decideAutoReply(message, classification, state.autoReplyPolicy, [
    ...state.faqCandidates.values(),
  ]);
  state.autoReplies.set(autoReply.id, autoReply);
}

export async function importSampleLog(
  state: Phase1State,
  path = sampleLogPath,
): Promise<{
  readonly imported: number;
  readonly skipped: number;
}> {
  const jsonl = await readFile(path, "utf8");
  const records = parseSampleJsonl(jsonl);
  let imported = 0;
  let skipped = 0;

  records.forEach((record, index) => {
    const message = normalizeSampleRecord(record, index);
    const before = state.messages.size;
    const ingested = ingestMessage(state, message);
    if (state.messages.size === before && ingested.id !== message.id) {
      skipped += 1;
      return;
    }
    imported += 1;
    processMessage(state, ingested);
  });

  return { imported, skipped };
}

export function refreshFaqCandidates(state: Phase1State): void {
  const candidates = generateFaqCandidates(
    [...state.messages.values()],
    [...state.classifications.values()],
  );
  state.faqCandidates.clear();
  for (const candidate of candidates) {
    state.faqCandidates.set(candidate.id, candidate);
  }
}

export function generateWeeklyReport(
  state: Phase1State,
  periodStart: string,
  periodEnd: string,
): WeeklyReport {
  refreshFaqCandidates(state);
  const report = buildWeeklyReport(
    periodStart,
    periodEnd,
    state.settings,
    [...state.messages.values()],
    [...state.classifications.values()],
    [...state.faqCandidates.values()],
    [...state.autoReplies.values()],
  );
  state.weeklyReports.set(report.id, report);
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
    feedback: listByCreatedAt(state.feedback.values()),
    queuedJobs: state.queuedJobs,
  };
}
