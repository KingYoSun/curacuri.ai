import { newId, nowIso } from "./ids.js";
import {
  fixedEscalationLabels,
  matchAutoReplyEscalationRule,
  sensitiveAutoReplyKeywords,
} from "./auto-reply-rules.js";
import {
  type AutoReply,
  type AutoReplyCategory,
  type AutoReplyPolicy,
  type Classification,
  type FaqCandidate,
  type Message,
  type SourceRef,
} from "../shared/types.js";

function hasAllowedLabel(policy: AutoReplyPolicy, classification: Classification): boolean {
  return classification.labels.some((label) => policy.allowedLabels.includes(label));
}

function categoryFor(
  message: Message,
  classification: Classification,
  sourceRefs: readonly SourceRef[],
): AutoReplyCategory {
  if (
    sourceRefs.length > 0 &&
    (classification.labels.includes("質問") || classification.labels.includes("高価値UGC"))
  ) {
    return "faq_reference";
  }
  if (
    classification.labels.includes("新規参加者の困りごと") ||
    message.content.includes("チャンネル")
  ) {
    return "channel_guide";
  }
  return "intake";
}

function sourceRefsForFaq(
  classification: Classification,
  faqCandidates: readonly FaqCandidate[],
  manualKnowledgeRefs: readonly SourceRef[] = [],
): readonly SourceRef[] {
  if (
    !classification.labels.some((label) =>
      ["質問", "高価値UGC", "新規参加者の困りごと"].includes(label),
    )
  ) {
    return [];
  }

  const accepted = faqCandidates.find((candidate) => candidate.status === "accepted");

  const refs: SourceRef[] = [...manualKnowledgeRefs.slice(0, 3)];
  if (accepted !== undefined && refs.length < 3) {
    refs.push({
      type: "approved_faq_candidate",
      title: accepted.topic,
    });
  }

  return refs;
}

function escalationReason(
  message: Message,
  classification: Classification,
  policy: AutoReplyPolicy,
  category: AutoReplyCategory,
  sourceRefs: readonly SourceRef[],
): string | null {
  if (!policy.enabled || policy.mode === "disabled") {
    return "自動返信は無効です。";
  }
  if (!policy.allowedChannelIds.includes(message.channelId)) {
    return "自動返信の許可チャンネル外です。";
  }
  if (!hasAllowedLabel(policy, classification)) {
    return "自動返信の許可ラベル外です。";
  }
  if (!policy.allowedCategories.includes(category)) {
    return "自動返信の許可カテゴリ外です。";
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

function replyBodyFor(
  message: Message,
  category: AutoReplyCategory,
  sourceRefs: readonly SourceRef[],
): string {
  if (category === "faq_reference" && sourceRefs.length > 0) {
    return `クラクリAIです。関連しそうなFAQ候補「${sourceRefs[0]?.title ?? "FAQ"}」を確認してください。公式判断が必要な場合は運営確認に回します。`;
  }
  if (category === "channel_guide") {
    return "クラクリAIです。投稿ありがとうございます。質問先や案内導線として確認し、必要なら運営確認に回します。";
  }
  if (message.content.includes("チャンネル")) {
    return "クラクリAIです。適切なチャンネル案内として記録しました。迷う投稿は運営確認に回します。";
  }
  return "クラクリAIです。投稿を記録しました。必要に応じて運営確認に回します。";
}

export function decideAutoReply(
  message: Message,
  classification: Classification,
  policy: AutoReplyPolicy,
  faqCandidates: readonly FaqCandidate[],
  manualKnowledgeRefs: readonly SourceRef[] = [],
): AutoReply {
  const sourceRefs =
    policy.mode === "faq_assist"
      ? sourceRefsForFaq(classification, faqCandidates, manualKnowledgeRefs)
      : [];
  const category = categoryFor(message, classification, sourceRefs);
  const reason = escalationReason(message, classification, policy, category, sourceRefs);
  const createdAt = nowIso();

  if (reason !== null) {
    return {
      id: newId(),
      messageId: message.id,
      classificationId: classification.id,
      mode: policy.mode,
      replyCategory: category,
      body: "",
      sourceRefs,
      confidence: classification.confidence,
      decisionReason: reason,
      status: reason.includes("無効") ? "blocked" : "escalated",
      sentMessageId: null,
      approvedBy: null,
      sentAt: null,
      createdAt,
    };
  }

  const matchedRule = matchAutoReplyEscalationRule(policy.escalationRules, {
    message,
    classification,
    category,
  });
  if (matchedRule !== null) {
    const status = matchedRule.rule.action === "do_not_reply" ? "blocked" : "escalated";
    if (matchedRule.rule.action !== "draft_for_approval") {
      return {
        id: newId(),
        messageId: message.id,
        classificationId: classification.id,
        mode: policy.mode,
        replyCategory: category,
        body: "",
        sourceRefs,
        confidence: classification.confidence,
        decisionReason: matchedRule.reason,
        status,
        sentMessageId: null,
        approvedBy: null,
        sentAt: null,
        createdAt,
      };
    }
  }

  const body = replyBodyFor(message, category, sourceRefs);
  return {
    id: newId(),
    messageId: message.id,
    classificationId: classification.id,
    mode: policy.mode,
    replyCategory: category,
    body,
    sourceRefs,
    confidence: classification.confidence,
    decisionReason:
      matchedRule?.rule.action === "draft_for_approval"
        ? matchedRule.reason
        : policy.mode === "approval_required"
          ? "回答案を生成し、管理者承認を待ちます。"
          : "許可範囲とエスカレーション条件を通過しました。",
    status:
      policy.mode === "approval_required" || matchedRule?.rule.action === "draft_for_approval"
        ? "pending_approval"
        : "sent",
    sentMessageId:
      policy.mode === "approval_required" || matchedRule?.rule.action === "draft_for_approval"
        ? null
        : newId(),
    approvedBy: null,
    sentAt:
      policy.mode === "approval_required" || matchedRule?.rule.action === "draft_for_approval"
        ? null
        : createdAt,
    createdAt,
  };
}
