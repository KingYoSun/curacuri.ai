import type {
  AdminNotification,
  AutoReply,
  EscalationAction,
  EscalationRuleType,
  FeedbackKind,
  FaqCandidate,
  FaqCandidateStatus,
  Importance,
  WeeklyReport,
} from "../shared/types.js";

export const feedbackKindLabels: Record<FeedbackKind, string> = {
  useful: "有用",
  unnecessary: "不要",
  misclassified: "分類違い",
  missed: "見落とし",
  unsafe_or_too_much: "過剰または危険",
  needs_escalation: "運営確認が必要",
};

export const escalationRuleTypeLabels: Record<EscalationRuleType, string> = {
  label: "ラベル",
  category: "カテゴリ",
  keyword: "キーワード",
  importance: "重要度",
  confidence: "confidence",
  official_needed: "公式回答",
  privacy_or_rule: "規約・個人情報",
};

export const escalationActionLabels: Record<EscalationAction, string> = {
  notify_admin: "運営通知",
  draft_for_approval: "承認待ち",
  do_not_reply: "返信しない",
};

export const faqStatusLabels: Record<FaqCandidateStatus, string> = {
  candidate: "候補",
  accepted: "採用",
  rejected: "却下",
  needs_review: "要確認",
};

export const importanceLabels: Record<Importance, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "緊急",
};

export const notificationStatusLabels: Record<AdminNotification["status"], string> = {
  pending: "送信待ち",
  sent: "送信済み",
  dismissed: "非表示",
  failed: "失敗",
};

export const autoReplyStatusLabels: Record<AutoReply["status"], string> = {
  drafted: "送信準備中",
  pending_approval: "承認待ち",
  sent: "送信済み",
  escalated: "運営確認",
  blocked: "ブロック",
  failed: "失敗",
};

export const autoReplyCategoryLabels: Record<AutoReply["replyCategory"], string> = {
  intake: "受付",
  channel_guide: "チャンネル案内",
  faq_reference: "FAQ参照",
  clarifying_question: "確認質問",
  approved_answer: "承認済み回答",
};

export const weeklyReportStatusLabels: Record<WeeklyReport["status"], string> = {
  generating: "生成中",
  ready: "準備完了",
  failed: "失敗",
};

export function confidenceLabel(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

export function faqPatchForStatus(status: FaqCandidateStatus): {
  readonly status: FaqCandidate["status"];
  readonly feedbackKind: FeedbackKind;
} {
  return {
    status,
    feedbackKind: status === "accepted" ? "useful" : "unnecessary",
  };
}
