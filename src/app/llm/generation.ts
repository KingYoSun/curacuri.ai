import { buildClassification } from "../../shared/validation.js";
import { newId, nowIso } from "../ids.js";
import type { Phase1State } from "../store.js";
import {
  type AutoReply,
  type AutoReplyCategory,
  type Classification,
  type FaqCandidate,
  type GuildSettings,
  type Message,
  type SourceRef,
  type WeeklyReport,
  type WeeklyReportMetrics,
} from "../../shared/types.js";
import { type LlmClient, LlmError } from "./client.js";
import {
  buildAutoReplyMessages,
  buildClassificationMessages,
  buildFaqCandidateMessages,
  buildWeeklyReportMessages,
} from "./prompts.js";
import { failLlmRun, finishLlmRun, startLlmRun } from "./runs.js";
import {
  parseLlmAutoReplyOutput,
  parseLlmFaqCandidatesOutput,
  parseLlmWeeklyReportOutput,
} from "./validation.js";

const escalationLabels = ["公式回答待ち", "炎上兆候", "誤情報可能性", "ルール違反候補"] as const;

const escalationKeywords = [
  "法務",
  "広報",
  "料金",
  "障害",
  "ロードマップ",
  "アカウント",
  "課金",
  "セキュリティ",
  "APIキー",
  "トークン",
  "個人情報",
] as const;

function hasAllowedLabel(
  policy: GuildSettings["autoReplyAllowedLabels"],
  classification: Classification,
): boolean {
  return classification.labels.some((label) => policy.includes(label));
}

function safeAutoReplyCategory(
  value: AutoReplyCategory | "escalate" | "do_not_reply",
): AutoReplyCategory {
  if (value === "escalate" || value === "do_not_reply") {
    return "intake";
  }
  return value;
}

function sourceRefsForFaq(
  classification: Classification,
  faqCandidates: readonly FaqCandidate[],
): readonly SourceRef[] {
  if (
    !classification.labels.some((label) =>
      ["質問", "高価値UGC", "新規参加者の困りごと"].includes(label),
    )
  ) {
    return [];
  }

  return faqCandidates
    .filter((candidate) => candidate.status === "accepted" || candidate.status === "candidate")
    .slice(0, 3)
    .map((candidate) => ({
      type: candidate.status === "accepted" ? "approved_faq_candidate" : "faq",
      title: candidate.topic,
      url: candidate.id,
    }));
}

function preEscalationReason(
  message: Message,
  classification: Classification,
  state: Phase1State,
  sourceRefs: readonly SourceRef[],
): string | null {
  const policy = state.autoReplyPolicy;
  if (!policy.enabled || policy.mode === "disabled") {
    return "自動返信は無効です。";
  }
  if (!policy.allowedChannelIds.includes(message.channelId)) {
    return "自動返信の許可チャンネル外です。";
  }
  if (!hasAllowedLabel(policy.allowedLabels, classification)) {
    return "自動返信の許可ラベル外です。";
  }
  if (classification.importance === "high" || classification.importance === "critical") {
    return "重要度が高いため運営確認に回します。";
  }
  if (classification.confidence < policy.minConfidence) {
    return "confidenceが自動返信の閾値未満です。";
  }
  if (escalationLabels.some((label) => classification.labels.includes(label))) {
    return "公式確認または運営確認が必要なラベルです。";
  }
  if (escalationKeywords.some((keyword) => message.content.includes(keyword))) {
    return "安全に自動回答できない話題を含みます。";
  }
  if (policy.mode === "faq_assist" && policy.requireSourceForFaq && sourceRefs.length === 0) {
    return "FAQ補助に必要な参照元がありません。";
  }
  return null;
}

function failedAutoReply(
  message: Message,
  classification: Classification,
  reason: string,
): AutoReply {
  return {
    id: newId(),
    messageId: message.id,
    classificationId: classification.id,
    mode: "disabled",
    replyCategory: "intake",
    body: "",
    sourceRefs: [],
    confidence: 0,
    decisionReason: reason,
    status: "failed",
    sentMessageId: null,
    approvedBy: null,
    sentAt: null,
    createdAt: nowIso(),
  };
}

function blockedAutoReply(
  message: Message,
  classification: Classification,
  state: Phase1State,
  reason: string,
  sourceRefs: readonly SourceRef[],
): AutoReply {
  return {
    id: newId(),
    messageId: message.id,
    classificationId: classification.id,
    mode: state.autoReplyPolicy.mode,
    replyCategory: "intake",
    body: "",
    sourceRefs,
    confidence: classification.confidence,
    decisionReason: reason,
    status: reason.includes("無効") ? "blocked" : "escalated",
    sentMessageId: null,
    approvedBy: null,
    sentAt: null,
    createdAt: nowIso(),
  };
}

export async function generateClassificationWithLlm(
  state: Phase1State,
  message: Message,
  client: LlmClient,
): Promise<Classification | null> {
  const run = startLlmRun(state, "classification", message.id, client.modelName);
  try {
    const result = await client.generateJson({
      taskType: "classification",
      messages: buildClassificationMessages(message),
    });
    const classification = buildClassification(result.rawJson, {
      id: newId(),
      messageId: message.id,
      modelName: result.modelName,
      createdAt: nowIso(),
    });
    state.classifications.set(classification.id, classification);
    finishLlmRun(state, run, result.rawJson);
    return classification;
  } catch (error) {
    failLlmRun(state, run, error);
    return null;
  }
}

export async function generateAutoReplyWithLlm(
  state: Phase1State,
  message: Message,
  classification: Classification,
  client: LlmClient,
): Promise<AutoReply> {
  const sourceRefs = sourceRefsForFaq(classification, [...state.faqCandidates.values()]);
  const preReason = preEscalationReason(message, classification, state, sourceRefs);
  if (preReason !== null) {
    return blockedAutoReply(message, classification, state, preReason, sourceRefs);
  }

  const run = startLlmRun(state, "auto_reply", message.id, client.modelName);
  try {
    const result = await client.generateJson({
      taskType: "auto_reply",
      messages: buildAutoReplyMessages(message, classification, state.autoReplyPolicy, sourceRefs),
    });
    const output = parseLlmAutoReplyOutput(result.rawJson);
    finishLlmRun(state, run, result.rawJson);

    const category = safeAutoReplyCategory(output.replyCategory);
    if (!state.autoReplyPolicy.allowedCategories.includes(category)) {
      return blockedAutoReply(
        message,
        classification,
        state,
        "LLM出力が許可カテゴリ外だったため運営確認に回します。",
        sourceRefs,
      );
    }
    if (output.confidence < state.autoReplyPolicy.minConfidence) {
      return blockedAutoReply(
        message,
        classification,
        state,
        "LLM出力のconfidenceが閾値未満です。",
        sourceRefs,
      );
    }
    if (output.decision === "do_not_reply") {
      return blockedAutoReply(message, classification, state, output.reason, sourceRefs);
    }
    if (output.decision === "escalate") {
      return {
        ...blockedAutoReply(message, classification, state, output.reason, sourceRefs),
        status: "escalated",
      };
    }

    const shouldHoldForApproval =
      state.autoReplyPolicy.mode === "approval_required" || output.decision === "pending_approval";
    const createdAt = nowIso();
    return {
      id: newId(),
      messageId: message.id,
      classificationId: classification.id,
      mode: state.autoReplyPolicy.mode,
      replyCategory: category,
      body: output.body,
      sourceRefs,
      confidence: output.confidence,
      decisionReason: output.reason,
      status: shouldHoldForApproval ? "pending_approval" : "sent",
      sentMessageId: shouldHoldForApproval ? null : newId(),
      approvedBy: null,
      sentAt: shouldHoldForApproval ? null : createdAt,
      createdAt,
    };
  } catch (error) {
    failLlmRun(state, run, error);
    return failedAutoReply(
      message,
      classification,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function generateFaqCandidatesWithLlm(
  state: Phase1State,
  client: LlmClient,
): Promise<readonly FaqCandidate[]> {
  const run = startLlmRun(state, "faq_candidates", "all", client.modelName);
  const messages = [...state.messages.values()];
  const classifications = [...state.classifications.values()];
  try {
    const result = await client.generateJson({
      taskType: "faq_candidates",
      messages: buildFaqCandidateMessages(messages, classifications),
    });
    const outputs = parseLlmFaqCandidatesOutput(result.rawJson);
    const validMessageIds = new Set(messages.map((message) => message.id));
    const now = nowIso();
    const candidates = outputs.map((output) => {
      const sourceMessageIds = output.sourceMessageIds.filter((id) => validMessageIds.has(id));
      if (sourceMessageIds.length === 0) {
        throw new LlmError(
          "invalid_output_schema",
          "FAQ candidate must reference at least one known message",
          result.rawJson,
        );
      }
      return {
        id: newId(),
        sourceMessageIds,
        topic: output.topic,
        currentAnswerStatus: output.currentAnswerStatus,
        draftQuestion: output.draftQuestion,
        draftAnswer: output.draftAnswer,
        confidence: output.confidence,
        status: output.status,
        createdAt: now,
        updatedAt: now,
      } satisfies FaqCandidate;
    });
    state.faqCandidates.clear();
    for (const candidate of candidates) {
      state.faqCandidates.set(candidate.id, candidate);
    }
    finishLlmRun(state, run, result.rawJson);
    return candidates;
  } catch (error) {
    failLlmRun(state, run, error);
    return [...state.faqCandidates.values()];
  }
}

export async function generateWeeklyReportWithLlm(
  state: Phase1State,
  client: LlmClient,
  fields: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly metrics: WeeklyReportMetrics;
  },
): Promise<WeeklyReport | null> {
  const targetId = `${fields.periodStart}:${fields.periodEnd}`;
  const run = startLlmRun(state, "weekly_report", targetId, client.modelName);
  const messages = [...state.messages.values()];
  const classifications = [...state.classifications.values()];
  const faqCandidates = [...state.faqCandidates.values()];
  try {
    const result = await client.generateJson({
      taskType: "weekly_report",
      messages: buildWeeklyReportMessages(
        fields.periodStart,
        fields.periodEnd,
        state.settings,
        messages,
        classifications,
        faqCandidates,
        fields.metrics,
      ),
    });
    const output = parseLlmWeeklyReportOutput(result.rawJson);
    const report: WeeklyReport = {
      id: newId(),
      periodStart: fields.periodStart,
      periodEnd: fields.periodEnd,
      targetChannelIds: state.settings.targetChannelIds,
      excludedChannelIds: state.settings.excludedChannelIds,
      messageCount: messages.length,
      shortBody: output.shortBody,
      detailedBody: output.detailedBody,
      metrics: fields.metrics,
      status: "ready",
      createdAt: nowIso(),
    };
    state.weeklyReports.set(report.id, report);
    finishLlmRun(state, run, result.rawJson);
    return report;
  } catch (error) {
    failLlmRun(state, run, error);
    return null;
  }
}
