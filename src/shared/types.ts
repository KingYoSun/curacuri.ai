export const classificationLabels = [
  "質問",
  "未回答質問",
  "公式回答待ち",
  "バグ報告",
  "要望",
  "不満",
  "称賛",
  "雑談",
  "炎上兆候",
  "誤情報可能性",
  "ルール違反候補",
  "高価値UGC",
  "新規参加者の困りごと",
  "古参の重要指摘",
] as const;

export type ClassificationLabel = (typeof classificationLabels)[number];

export const importances = ["low", "medium", "high", "critical"] as const;

export type Importance = (typeof importances)[number];

export const adminActionTypes = [
  "none",
  "weekly_report",
  "reply_check",
  "bug_triage",
  "faq_candidate",
  "announcement_check",
  "privacy_or_rule_check",
] as const;

export type AdminActionType = (typeof adminActionTypes)[number];

export const autoReplyModes = [
  "disabled",
  "intake_only",
  "faq_assist",
  "approval_required",
] as const;

export type AutoReplyMode = (typeof autoReplyModes)[number];

export const autoReplyCategories = [
  "intake",
  "channel_guide",
  "faq_reference",
  "clarifying_question",
  "approved_answer",
] as const;

export type AutoReplyCategory = (typeof autoReplyCategories)[number];

export const autoReplyStatuses = [
  "drafted",
  "pending_approval",
  "sent",
  "escalated",
  "blocked",
  "failed",
] as const;

export type AutoReplyStatus = (typeof autoReplyStatuses)[number];

export const escalationActions = ["notify_admin", "draft_for_approval", "do_not_reply"] as const;

export type EscalationAction = (typeof escalationActions)[number];

export const escalationRuleTypes = [
  "label",
  "category",
  "keyword",
  "importance",
  "confidence",
  "official_needed",
  "privacy_or_rule",
] as const;

export type EscalationRuleType = (typeof escalationRuleTypes)[number];

export const feedbackKinds = [
  "useful",
  "unnecessary",
  "misclassified",
  "missed",
  "unsafe_or_too_much",
  "needs_escalation",
] as const;

export type FeedbackKind = (typeof feedbackKinds)[number];

export const notificationTypes = [
  "official_reply",
  "bug_cluster",
  "complaint_increase",
  "misinformation",
  "fire_risk",
  "privacy_or_rule",
  "unanswered_question",
] as const;

export type NotificationType = (typeof notificationTypes)[number];

export type NotificationStatus = "pending" | "sent" | "dismissed" | "failed";

export const faqCandidateStatuses = ["candidate", "accepted", "rejected", "needs_review"] as const;

export type FaqCandidateStatus = (typeof faqCandidateStatuses)[number];

export type CurrentAnswerStatus =
  | "unknown"
  | "answered_in_thread"
  | "needs_official_answer"
  | "existing_faq_possible";

export const manualKnowledgeSourceTypes = [
  "official_faq",
  "docs",
  "channel_guide",
  "template_reply",
] as const;

export type ManualKnowledgeSourceType = (typeof manualKnowledgeSourceTypes)[number];

export const manualKnowledgeStatuses = ["draft", "published", "archived"] as const;

export type ManualKnowledgeStatus = (typeof manualKnowledgeStatuses)[number];

export type WeeklyReportStatus = "generating" | "ready" | "failed";

export const llmTaskTypes = [
  "classification",
  "auto_reply",
  "faq_candidates",
  "weekly_report",
] as const;

export type LlmTaskType = (typeof llmTaskTypes)[number];

export const llmRunStatuses = ["pending", "running", "succeeded", "failed"] as const;

export type LlmRunStatus = (typeof llmRunStatuses)[number];

export type LlmGenerationRun = {
  readonly id: string;
  readonly taskType: LlmTaskType;
  readonly targetId: string;
  readonly status: LlmRunStatus;
  readonly modelName: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly rawOutput: Record<string, unknown> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type MessageSource = "discord" | "sample_log";

export type GuildSettings = {
  readonly id: string;
  readonly guildId: string;
  readonly targetChannelIds: readonly string[];
  readonly excludedChannelIds: readonly string[];
  readonly adminNotificationChannelId: string;
  readonly retentionDays: number;
  readonly characterName: string;
  readonly characterTone: string;
  readonly autoReplyMode: AutoReplyMode;
  readonly autoReplyAllowedChannelIds: readonly string[];
  readonly autoReplyAllowedLabels: readonly ClassificationLabel[];
  readonly autoReplyAllowedCategories: readonly AutoReplyCategory[];
  readonly autoReplyEscalationRules: readonly EscalationRule[];
  readonly autoReplyMinConfidence: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type Message = {
  readonly id: string;
  readonly source: MessageSource;
  readonly guildId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly messageId: string;
  readonly threadId: string | null;
  readonly authorIdHash: string;
  readonly content: string;
  readonly postedAt: string;
  readonly ingestedAt: string;
  readonly deletedAt: string | null;
};

export type Classification = {
  readonly id: string;
  readonly messageId: string;
  readonly labels: readonly ClassificationLabel[];
  readonly importance: Importance;
  readonly adminActionNeeded: boolean;
  readonly adminActionType: AdminActionType;
  readonly confidence: number;
  readonly reason: string;
  readonly suggestedSummary: string;
  readonly modelName: string;
  readonly rawOutput: Record<string, unknown>;
  readonly createdAt: string;
};

export type AdminNotification = {
  readonly id: string;
  readonly notificationType: NotificationType;
  readonly messageIds: readonly string[];
  readonly title: string;
  readonly body: string;
  readonly importance: "high" | "critical";
  readonly status: NotificationStatus;
  readonly sentToChannelId: string;
  readonly sentMessageId: string | null;
  readonly sentAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
};

export type AutoReplyPolicy = {
  readonly id: string;
  readonly guildId: string;
  readonly enabled: boolean;
  readonly mode: AutoReplyMode;
  readonly allowedChannelIds: readonly string[];
  readonly allowedLabels: readonly ClassificationLabel[];
  readonly allowedCategories: readonly AutoReplyCategory[];
  readonly blockedCategories: readonly string[];
  readonly minConfidence: number;
  readonly requireSourceForFaq: boolean;
  readonly escalationRules: readonly EscalationRule[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type EscalationRule = {
  readonly id: string;
  readonly guildId: string;
  readonly ruleType: EscalationRuleType;
  readonly condition: Record<string, unknown>;
  readonly action: EscalationAction;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type SourceRef = {
  readonly type: "faq" | "docs" | "approved_faq_candidate" | "manual_knowledge";
  readonly title: string;
  readonly url?: string;
  readonly sourceId?: string;
  readonly sourceType?: ManualKnowledgeSourceType;
  readonly excerpt?: string;
  readonly score?: number;
};

export type AutoReply = {
  readonly id: string;
  readonly messageId: string;
  readonly classificationId: string;
  readonly mode: AutoReplyMode;
  readonly replyCategory: AutoReplyCategory;
  readonly body: string;
  readonly sourceRefs: readonly SourceRef[];
  readonly confidence: number;
  readonly decisionReason: string;
  readonly status: AutoReplyStatus;
  readonly sentMessageId: string | null;
  readonly approvedBy: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
};

export type FaqCandidate = {
  readonly id: string;
  readonly sourceMessageIds: readonly string[];
  readonly topic: string;
  readonly currentAnswerStatus: CurrentAnswerStatus;
  readonly draftQuestion: string;
  readonly draftAnswer: string;
  readonly confidence: number;
  readonly status: FaqCandidateStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ManualKnowledge = {
  readonly id: string;
  readonly guildId: string;
  readonly sourceType: ManualKnowledgeSourceType;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly tags: readonly string[];
  readonly status: ManualKnowledgeStatus;
  readonly embeddingModel: string | null;
  readonly embeddingUpdatedAt: string | null;
  readonly embeddingError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ManualKnowledgeSearchResult = {
  readonly item: ManualKnowledge;
  readonly score: number;
};

export type WeeklyReportMetrics = {
  readonly unansweredQuestionCount: number;
  readonly bugReportCount: number;
  readonly featureRequestCount: number;
  readonly complaintCount: number;
  readonly faqCandidateCount: number;
  readonly autoReplySentCount: number;
  readonly autoReplyEscalatedCount: number;
};

export type WeeklyReport = {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly targetChannelIds: readonly string[];
  readonly excludedChannelIds: readonly string[];
  readonly messageCount: number;
  readonly shortBody: string;
  readonly detailedBody: string;
  readonly metrics: WeeklyReportMetrics;
  readonly status: WeeklyReportStatus;
  readonly createdAt: string;
};

export type AdminFeedback = {
  readonly id: string;
  readonly targetType:
    | "classification"
    | "notification"
    | "faq_candidate"
    | "weekly_report"
    | "auto_reply";
  readonly targetId: string;
  readonly feedbackKind: FeedbackKind;
  readonly note: string;
  readonly createdAt: string;
};

export type DiscordEvent = {
  readonly guildId: string | null;
  readonly channelId: string;
  readonly channelName: string;
  readonly messageId: string;
  readonly threadId?: string | null;
  readonly authorId: string;
  readonly content: string;
  readonly postedAt: string;
  readonly isDm: boolean;
};

export type SampleLogRecord = {
  readonly text: string;
  readonly channel_context: string;
  readonly expected_labels?: readonly ClassificationLabel[];
  readonly importance?: Importance;
  readonly admin_action_needed?: boolean;
  readonly notes?: string;
};
