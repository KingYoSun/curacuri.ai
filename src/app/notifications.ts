import { newId, nowIso } from "./ids.js";
import {
  type AdminNotification,
  type Classification,
  type GuildSettings,
  type Message,
  type NotificationType,
} from "../shared/types.js";

const highRiskLabels = [
  "公式回答待ち",
  "炎上兆候",
  "誤情報可能性",
  "ルール違反候補",
  "未回答質問",
] as const;

function notificationTypeFor(classification: Classification): NotificationType {
  if (classification.labels.includes("炎上兆候")) {
    return "fire_risk";
  }
  if (classification.labels.includes("誤情報可能性")) {
    return "misinformation";
  }
  if (classification.labels.includes("ルール違反候補")) {
    return "privacy_or_rule";
  }
  if (classification.labels.includes("未回答質問")) {
    return "unanswered_question";
  }
  if (classification.labels.includes("バグ報告")) {
    return "bug_cluster";
  }
  return "official_reply";
}

export function shouldCreateAdminNotification(classification: Classification): boolean {
  return (
    classification.adminActionNeeded ||
    classification.importance === "high" ||
    classification.importance === "critical" ||
    highRiskLabels.some((label) => classification.labels.includes(label))
  );
}

export function createAdminNotification(
  message: Message,
  classification: Classification,
  settings: GuildSettings,
): AdminNotification | null {
  if (!shouldCreateAdminNotification(classification)) {
    return null;
  }

  const notificationType = notificationTypeFor(classification);
  const importance = classification.importance === "critical" ? "critical" : "high";
  return {
    id: newId(),
    notificationType,
    messageIds: [message.id],
    title: `運営確認: ${classification.labels.join(" / ")}`,
    body: [
      "運営確認が必要そうな投稿です。",
      `チャンネル: ${message.channelName}`,
      `要点: ${classification.suggestedSummary}`,
      `理由: ${classification.reason}`,
    ].join("\n"),
    importance,
    status: "pending",
    sentToChannelId: settings.adminNotificationChannelId,
    sentMessageId: null,
    sentAt: null,
    failureReason: null,
    createdAt: nowIso(),
  };
}
