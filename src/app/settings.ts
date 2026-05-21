import { newId, nowIso } from "./ids.js";
import {
  type AutoReplyPolicy,
  type ClassificationLabel,
  type GuildSettings,
} from "../shared/types.js";

export const sampleGuildId = "dogfood-alpha-sample";

export const defaultAllowedLabels = [
  "質問",
  "新規参加者の困りごと",
  "高価値UGC",
] satisfies readonly ClassificationLabel[];

export function createDefaultSettings(): GuildSettings {
  const now = nowIso();
  return {
    id: newId(),
    guildId: sampleGuildId,
    targetChannelIds: [
      "support",
      "bugs",
      "feature-requests",
      "general",
      "feedback",
      "dev-help",
      "tips",
      "welcome",
      "showcase",
    ],
    excludedChannelIds: [],
    adminNotificationChannelId: "ops-admin",
    retentionDays: 90,
    characterName: "クラクリAI",
    characterTone: "丁寧な書記",
    autoReplyMode: "disabled",
    autoReplyAllowedChannelIds: ["support", "dev-help", "welcome"],
    autoReplyAllowedLabels: defaultAllowedLabels,
    autoReplyAllowedCategories: ["intake", "channel_guide", "faq_reference"],
    autoReplyEscalationRules: [],
    autoReplyMinConfidence: 0.8,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultAutoReplyPolicy(settings: GuildSettings): AutoReplyPolicy {
  const now = nowIso();
  return {
    id: newId(),
    guildId: settings.guildId,
    enabled: false,
    mode: "disabled",
    allowedChannelIds: settings.autoReplyAllowedChannelIds,
    allowedLabels: settings.autoReplyAllowedLabels,
    allowedCategories: settings.autoReplyAllowedCategories,
    blockedCategories: ["legal", "pr", "pricing", "incident", "roadmap", "account", "security"],
    minConfidence: settings.autoReplyMinConfidence,
    requireSourceForFaq: true,
    escalationRules: settings.autoReplyEscalationRules,
    createdAt: now,
    updatedAt: now,
  };
}

export function syncSettingsWithAutoReplyPolicy(
  settings: GuildSettings,
  policy: AutoReplyPolicy,
): GuildSettings {
  return {
    ...settings,
    autoReplyMode: policy.enabled ? policy.mode : "disabled",
    autoReplyAllowedChannelIds: policy.allowedChannelIds,
    autoReplyAllowedLabels: policy.allowedLabels,
    autoReplyAllowedCategories: policy.allowedCategories,
    autoReplyEscalationRules: policy.escalationRules,
    autoReplyMinConfidence: policy.minConfidence,
  };
}
