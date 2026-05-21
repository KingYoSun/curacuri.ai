import type {
  AdminNotification,
  AutoReply,
  AutoReplyPolicy,
  Classification,
  FeedbackKind,
  FaqCandidate,
  GuildSettings,
  LlmGenerationRun,
  Message,
  WeeklyReport,
} from "../shared/types.js";

export type Settings = Pick<
  GuildSettings,
  | "targetChannelIds"
  | "excludedChannelIds"
  | "adminNotificationChannelId"
  | "retentionDays"
  | "characterName"
  | "characterTone"
>;

export type Policy = Pick<
  AutoReplyPolicy,
  | "enabled"
  | "mode"
  | "allowedChannelIds"
  | "allowedLabels"
  | "allowedCategories"
  | "minConfidence"
  | "requireSourceForFaq"
>;

export type LlmStatus = {
  readonly configured: boolean;
  readonly modelName: string;
  readonly baseUrl: string;
  readonly concurrency: number;
  readonly responseFormat: string;
  readonly failedCount: number;
};

export type LlmRun = Pick<
  LlmGenerationRun,
  | "id"
  | "taskType"
  | "targetId"
  | "status"
  | "modelName"
  | "errorCode"
  | "errorMessage"
  | "createdAt"
>;

export type MessageFilters = {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly channelId: string;
  readonly label: string;
};

export type DashboardData = {
  readonly settings: Settings;
  readonly policy: Policy;
  readonly messages: readonly Message[];
  readonly classifications: readonly Classification[];
  readonly notifications: readonly AdminNotification[];
  readonly faqCandidates: readonly FaqCandidate[];
  readonly autoReplies: readonly AutoReply[];
  readonly weeklyReports: readonly WeeklyReport[];
  readonly llmStatus: LlmStatus;
  readonly failedRuns: readonly LlmRun[];
};

export type SettingsDraft = {
  readonly targetChannelIds: string;
  readonly excludedChannelIds: string;
  readonly adminNotificationChannelId: string;
  readonly retentionDays: number;
  readonly characterName: string;
  readonly characterTone: string;
};

export type PolicyDraft = {
  readonly enabled: boolean;
  readonly mode: string;
  readonly allowedChannelIds: string;
  readonly allowedLabels: string;
  readonly allowedCategories: string;
  readonly minConfidence: number;
  readonly requireSourceForFaq: boolean;
};

export type FeedbackDraft = {
  readonly feedbackKind: FeedbackKind;
  readonly note: string;
};
