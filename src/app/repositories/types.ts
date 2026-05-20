import type { Phase1State } from "../store.js";
import type {
  AdminFeedback,
  AdminNotification,
  AutoReply,
  AutoReplyPolicy,
  Classification,
  FaqCandidate,
  GuildSettings,
  LlmGenerationRun,
  Message,
  WeeklyReport,
} from "../../shared/types.js";

export type MessageFilters = {
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly channelId?: string;
  readonly label?: string;
};

export type Phase1Repository = {
  ensureSeed(): Promise<void>;
  close(): Promise<void>;
  loadState(): Promise<Phase1State>;
  saveState(state: Phase1State): Promise<void>;
  getSettings(): Promise<GuildSettings>;
  updateSettings(settings: GuildSettings): Promise<GuildSettings>;
  getAutoReplyPolicy(): Promise<AutoReplyPolicy>;
  updateAutoReplyPolicy(policy: AutoReplyPolicy): Promise<AutoReplyPolicy>;
  upsertMessage(
    message: Message,
  ): Promise<{ readonly message: Message; readonly created: boolean }>;
  getMessage(id: string): Promise<Message | null>;
  listMessages(filters?: MessageFilters): Promise<readonly Message[]>;
  listClassifications(): Promise<readonly Classification[]>;
  getClassification(id: string): Promise<Classification | null>;
  findClassificationByMessageId(messageId: string): Promise<Classification | null>;
  listNotifications(): Promise<readonly AdminNotification[]>;
  getNotification(id: string): Promise<AdminNotification | null>;
  saveNotification(notification: AdminNotification): Promise<void>;
  markNotificationSent(id: string, sentMessageId: string): Promise<void>;
  markNotificationFailed(id: string, reason: string): Promise<void>;
  listAutoReplies(): Promise<readonly AutoReply[]>;
  getAutoReply(id: string): Promise<AutoReply | null>;
  saveAutoReply(autoReply: AutoReply): Promise<void>;
  updateAutoReply(autoReply: AutoReply): Promise<void>;
  listFaqCandidates(): Promise<readonly FaqCandidate[]>;
  getFaqCandidate(id: string): Promise<FaqCandidate | null>;
  updateFaqCandidateStatus(id: string, status: FaqCandidate["status"]): Promise<void>;
  listWeeklyReports(): Promise<readonly WeeklyReport[]>;
  getWeeklyReport(id: string): Promise<WeeklyReport | null>;
  listLlmRuns(status?: LlmGenerationRun["status"]): Promise<readonly LlmGenerationRun[]>;
  getLlmRun(id: string): Promise<LlmGenerationRun | null>;
  saveFeedback(feedback: AdminFeedback): Promise<void>;
  logicalDeleteExpiredMessages(retentionDays: number): Promise<number>;
};
