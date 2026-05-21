import { buildClassification } from "../../shared/validation.js";
import {
  fixedEscalationLabels,
  matchAutoReplyEscalationRule,
  sensitiveAutoReplyKeywords,
} from "../auto-reply-rules.js";
import { newId, nowIso } from "../ids.js";
import {
  type AutoReply,
  type AutoReplyCategory,
  type AutoReplyPolicy,
  type Classification,
  type FaqCandidate,
  type GuildSettings,
  type LlmGenerationRun,
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

export type ClassificationLlmGeneration = {
  readonly classification: Classification | null;
  readonly run: LlmGenerationRun;
};

export type AutoReplyLlmGeneration = {
  readonly autoReply: AutoReply;
  readonly run: LlmGenerationRun | null;
};

export type FaqCandidatesLlmGeneration = {
  readonly candidates: readonly FaqCandidate[] | null;
  readonly run: LlmGenerationRun;
};

export type WeeklyReportLlmGeneration = {
  readonly report: WeeklyReport | null;
  readonly run: LlmGenerationRun;
};

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
  policy: AutoReplyPolicy,
  sourceRefs: readonly SourceRef[],
): string | null {
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
  if (fixedEscalationLabels.some((label) => classification.labels.includes(label))) {
    return "公式確認または運営確認が必要なラベルです。";
  }
  if (sensitiveAutoReplyKeywords.some((keyword) => message.content.includes(keyword))) {
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
  policy: AutoReplyPolicy,
  reason: string,
  sourceRefs: readonly SourceRef[],
): AutoReply {
  return {
    id: newId(),
    messageId: message.id,
    classificationId: classification.id,
    mode: policy.mode,
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
  message: Message,
  client: LlmClient,
): Promise<ClassificationLlmGeneration> {
  const run = startLlmRun("classification", message.id, client.modelName);
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
    return {
      classification,
      run: finishLlmRun(run, result.rawJson),
    };
  } catch (error) {
    return {
      classification: null,
      run: failLlmRun(run, error),
    };
  }
}

export async function generateAutoReplyWithLlm(
  message: Message,
  classification: Classification,
  autoReplyPolicy: AutoReplyPolicy,
  faqCandidates: readonly FaqCandidate[],
  client: LlmClient,
): Promise<AutoReplyLlmGeneration> {
  const sourceRefs = sourceRefsForFaq(classification, faqCandidates);
  const preReason = preEscalationReason(message, classification, autoReplyPolicy, sourceRefs);
  if (preReason !== null) {
    return {
      autoReply: blockedAutoReply(message, classification, autoReplyPolicy, preReason, sourceRefs),
      run: null,
    };
  }

  const preMatchedRule = matchAutoReplyEscalationRule(autoReplyPolicy.escalationRules, {
    message,
    classification,
  });
  if (preMatchedRule?.rule.action === "do_not_reply") {
    return {
      autoReply: {
        ...blockedAutoReply(
          message,
          classification,
          autoReplyPolicy,
          preMatchedRule.reason,
          sourceRefs,
        ),
        status: "blocked",
      },
      run: null,
    };
  }
  if (preMatchedRule?.rule.action === "notify_admin") {
    return {
      autoReply: {
        ...blockedAutoReply(
          message,
          classification,
          autoReplyPolicy,
          preMatchedRule.reason,
          sourceRefs,
        ),
        status: "escalated",
      },
      run: null,
    };
  }

  const run = startLlmRun("auto_reply", message.id, client.modelName);
  try {
    const result = await client.generateJson({
      taskType: "auto_reply",
      messages: buildAutoReplyMessages(message, classification, autoReplyPolicy, sourceRefs),
    });
    const output = parseLlmAutoReplyOutput(result.rawJson);
    const finishedRun = finishLlmRun(run, result.rawJson);

    const category = safeAutoReplyCategory(output.replyCategory);
    if (!autoReplyPolicy.allowedCategories.includes(category)) {
      return {
        autoReply: blockedAutoReply(
          message,
          classification,
          autoReplyPolicy,
          "LLM出力が許可カテゴリ外だったため運営確認に回します。",
          sourceRefs,
        ),
        run: finishedRun,
      };
    }
    if (output.confidence < autoReplyPolicy.minConfidence) {
      return {
        autoReply: blockedAutoReply(
          message,
          classification,
          autoReplyPolicy,
          "LLM出力のconfidenceが閾値未満です。",
          sourceRefs,
        ),
        run: finishedRun,
      };
    }
    if (output.decision === "do_not_reply") {
      return {
        autoReply: blockedAutoReply(
          message,
          classification,
          autoReplyPolicy,
          output.reason,
          sourceRefs,
        ),
        run: finishedRun,
      };
    }
    if (output.decision === "escalate") {
      return {
        autoReply: {
          ...blockedAutoReply(message, classification, autoReplyPolicy, output.reason, sourceRefs),
          status: "escalated",
        },
        run: finishedRun,
      };
    }

    const matchedRule = matchAutoReplyEscalationRule(autoReplyPolicy.escalationRules, {
      message,
      classification,
      category,
    });
    if (matchedRule?.rule.action === "do_not_reply") {
      return {
        autoReply: {
          ...blockedAutoReply(
            message,
            classification,
            autoReplyPolicy,
            matchedRule.reason,
            sourceRefs,
          ),
          replyCategory: category,
          status: "blocked",
        },
        run: finishedRun,
      };
    }
    if (matchedRule?.rule.action === "notify_admin") {
      return {
        autoReply: {
          ...blockedAutoReply(
            message,
            classification,
            autoReplyPolicy,
            matchedRule.reason,
            sourceRefs,
          ),
          replyCategory: category,
          status: "escalated",
        },
        run: finishedRun,
      };
    }

    const shouldHoldForApproval =
      autoReplyPolicy.mode === "approval_required" ||
      output.decision === "pending_approval" ||
      preMatchedRule?.rule.action === "draft_for_approval" ||
      matchedRule?.rule.action === "draft_for_approval";
    const createdAt = nowIso();
    return {
      autoReply: {
        id: newId(),
        messageId: message.id,
        classificationId: classification.id,
        mode: autoReplyPolicy.mode,
        replyCategory: category,
        body: output.body,
        sourceRefs,
        confidence: output.confidence,
        decisionReason:
          preMatchedRule?.rule.action === "draft_for_approval"
            ? preMatchedRule.reason
            : matchedRule?.rule.action === "draft_for_approval"
              ? matchedRule.reason
              : output.reason,
        status: shouldHoldForApproval ? "pending_approval" : "sent",
        sentMessageId: shouldHoldForApproval ? null : newId(),
        approvedBy: null,
        sentAt: shouldHoldForApproval ? null : createdAt,
        createdAt,
      },
      run: finishedRun,
    };
  } catch (error) {
    return {
      autoReply: failedAutoReply(
        message,
        classification,
        error instanceof Error ? error.message : String(error),
      ),
      run: failLlmRun(run, error),
    };
  }
}

export async function generateFaqCandidatesWithLlm(
  messages: readonly Message[],
  classifications: readonly Classification[],
  client: LlmClient,
): Promise<FaqCandidatesLlmGeneration> {
  const run = startLlmRun("faq_candidates", "all", client.modelName);
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
    return {
      candidates,
      run: finishLlmRun(run, result.rawJson),
    };
  } catch (error) {
    return {
      candidates: null,
      run: failLlmRun(run, error),
    };
  }
}

export async function generateWeeklyReportWithLlm(
  client: LlmClient,
  fields: {
    readonly settings: GuildSettings;
    readonly messages: readonly Message[];
    readonly classifications: readonly Classification[];
    readonly faqCandidates: readonly FaqCandidate[];
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly metrics: WeeklyReportMetrics;
  },
): Promise<WeeklyReportLlmGeneration> {
  const targetId = `${fields.periodStart}:${fields.periodEnd}`;
  const run = startLlmRun("weekly_report", targetId, client.modelName);
  try {
    const result = await client.generateJson({
      taskType: "weekly_report",
      messages: buildWeeklyReportMessages(
        fields.periodStart,
        fields.periodEnd,
        fields.settings,
        fields.messages,
        fields.classifications,
        fields.faqCandidates,
        fields.metrics,
      ),
    });
    const output = parseLlmWeeklyReportOutput(result.rawJson);
    const report: WeeklyReport = {
      id: newId(),
      periodStart: fields.periodStart,
      periodEnd: fields.periodEnd,
      targetChannelIds: fields.settings.targetChannelIds,
      excludedChannelIds: fields.settings.excludedChannelIds,
      messageCount: fields.messages.length,
      shortBody: output.shortBody,
      detailedBody: output.detailedBody,
      metrics: fields.metrics,
      status: "ready",
      createdAt: nowIso(),
    };
    return {
      report,
      run: finishLlmRun(run, result.rawJson),
    };
  } catch (error) {
    return {
      report: null,
      run: failLlmRun(run, error),
    };
  }
}
