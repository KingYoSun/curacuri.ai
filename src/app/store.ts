import { createDefaultAutoReplyPolicy, createDefaultSettings } from "./settings.js";
import {
  type AdminFeedback,
  type AdminNotification,
  type AutoReply,
  type AutoReplyPolicy,
  type Classification,
  type FaqCandidate,
  type GuildSettings,
  type LlmGenerationRun,
  type Message,
  type WeeklyReport,
} from "../shared/types.js";

export type Phase1State = {
  settings: GuildSettings;
  autoReplyPolicy: AutoReplyPolicy;
  readonly messages: Map<string, Message>;
  readonly classifications: Map<string, Classification>;
  readonly notifications: Map<string, AdminNotification>;
  readonly autoReplies: Map<string, AutoReply>;
  readonly faqCandidates: Map<string, FaqCandidate>;
  readonly weeklyReports: Map<string, WeeklyReport>;
  readonly llmGenerationRuns: Map<string, LlmGenerationRun>;
  readonly feedback: Map<string, AdminFeedback>;
  readonly queuedJobs: {
    readonly queueName: string;
    readonly payload: unknown;
  }[];
};

export function createPhase1State(): Phase1State {
  const settings = createDefaultSettings();
  return {
    settings,
    autoReplyPolicy: createDefaultAutoReplyPolicy(settings),
    messages: new Map(),
    classifications: new Map(),
    notifications: new Map(),
    autoReplies: new Map(),
    faqCandidates: new Map(),
    weeklyReports: new Map(),
    llmGenerationRuns: new Map(),
    feedback: new Map(),
    queuedJobs: [],
  };
}

export function listByCreatedAt<T extends { readonly createdAt: string }>(
  values: Iterable<T>,
): readonly T[] {
  return [...values].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listByIngestedAt<T extends { readonly ingestedAt: string }>(
  values: Iterable<T>,
): readonly T[] {
  return [...values].sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
}
