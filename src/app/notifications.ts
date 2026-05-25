import { newId, nowIso } from "./ids.js";
import {
  type AdminNotification,
  type Classification,
  type GuildSettings,
  type Message,
  type NotificationType,
} from "../shared/types.js";

type MessageWithClassification = {
  readonly message: Message;
  readonly classification: Classification;
};

const highRiskLabels = [
  "公式回答待ち",
  "炎上兆候",
  "誤情報可能性",
  "ルール違反候補",
  "未回答質問",
] as const;

const aggregateTitlePrefix = "集約:";
const oneDayMs = 24 * 60 * 60 * 1000;
const sevenDaysMs = 7 * oneDayMs;

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

function postedAtMs(message: Message): number {
  const time = Date.parse(message.postedAt);
  return Number.isNaN(time) ? 0 : time;
}

function activePairs(
  messages: Iterable<Message>,
  classifications: Iterable<Classification>,
): readonly MessageWithClassification[] {
  const messagesById = new Map(
    [...messages]
      .filter((message) => message.deletedAt === null)
      .map((message) => [message.id, message]),
  );
  return [...classifications]
    .map((classification) => {
      const message = messagesById.get(classification.messageId);
      return message === undefined ? null : { message, classification };
    })
    .filter((item): item is MessageWithClassification => item !== null);
}

function recentPairs(
  pairs: readonly MessageWithClassification[],
  now: Date,
  windowMs: number,
): readonly MessageWithClassification[] {
  const min = now.getTime() - windowMs;
  return pairs.filter((pair) => postedAtMs(pair.message) >= min);
}

function beforeTodayPairs(
  pairs: readonly MessageWithClassification[],
  now: Date,
): readonly MessageWithClassification[] {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return pairs.filter((pair) => postedAtMs(pair.message) < todayStart.getTime());
}

function distinctAuthors(pairs: readonly MessageWithClassification[]): number {
  return new Set(pairs.map((pair) => pair.message.authorIdHash)).size;
}

function summarizePairs(pairs: readonly MessageWithClassification[]): string {
  return pairs
    .slice(0, 5)
    .map((pair) => `- ${pair.message.channelName}: ${pair.classification.suggestedSummary}`)
    .join("\n");
}

function aggregateNotification(
  settings: GuildSettings,
  notificationType: NotificationType,
  title: string,
  bodyLines: readonly string[],
  pairs: readonly MessageWithClassification[],
): AdminNotification {
  const importance = pairs.some((pair) => pair.classification.importance === "critical")
    ? "critical"
    : "high";
  return {
    id: newId(),
    notificationType,
    messageIds: pairs.map((pair) => pair.message.id),
    title: `${aggregateTitlePrefix} ${title}`,
    body: [...bodyLines, "", "代表投稿:", summarizePairs(pairs)].join("\n"),
    importance,
    status: "pending",
    sentToChannelId: settings.adminNotificationChannelId,
    sentMessageId: null,
    sentAt: null,
    failureReason: null,
    createdAt: nowIso(),
  };
}

export function createAggregateAdminNotifications(
  messages: Iterable<Message>,
  classifications: Iterable<Classification>,
  settings: GuildSettings,
  now = new Date(),
): readonly AdminNotification[] {
  const pairs = activePairs(messages, classifications);
  const notifications: AdminNotification[] = [];

  const recentBugs = recentPairs(pairs, now, sevenDaysMs).filter((pair) =>
    pair.classification.labels.includes("バグ報告"),
  );
  if (recentBugs.length >= 2 && distinctAuthors(recentBugs) >= 2) {
    notifications.push(
      aggregateNotification(
        settings,
        "bug_cluster",
        "複数ユーザーの不具合報告",
        [
          `直近7日で複数ユーザーから不具合報告が出ています。`,
          `件数: ${String(recentBugs.length)}件 / 投稿者: ${String(distinctAuthors(recentBugs))}人`,
        ],
        recentBugs,
      ),
    );
  }

  const recentComplaints = recentPairs(pairs, now, oneDayMs).filter((pair) =>
    pair.classification.labels.includes("不満"),
  );
  if (recentComplaints.length >= 3) {
    notifications.push(
      aggregateNotification(
        settings,
        "complaint_increase",
        "不満投稿の急増",
        [
          "直近24時間で不満に分類された投稿が増えています。",
          `件数: ${String(recentComplaints.length)}件`,
        ],
        recentComplaints,
      ),
    );
  }

  const oldUnanswered = beforeTodayPairs(pairs, now).filter(
    (pair) =>
      pair.classification.labels.includes("未回答質問") ||
      (pair.classification.labels.includes("質問") && pair.classification.adminActionNeeded),
  );
  if (oldUnanswered.length > 0) {
    notifications.push(
      aggregateNotification(
        settings,
        "unanswered_question",
        "昨日以前の未回答質問",
        [
          "昨日以前の投稿で未回答の可能性がある質問です。",
          `件数: ${String(oldUnanswered.length)}件`,
        ],
        oldUnanswered,
      ),
    );
  }

  return notifications;
}

export function upsertAggregateAdminNotifications(
  notifications: Map<string, AdminNotification>,
  aggregates: readonly AdminNotification[],
): void {
  for (const aggregate of aggregates) {
    const existing = [...notifications.values()].find(
      (notification) =>
        notification.notificationType === aggregate.notificationType &&
        notification.title.startsWith(aggregateTitlePrefix) &&
        notification.status !== "sent" &&
        notification.status !== "dismissed",
    );
    notifications.set(existing?.id ?? aggregate.id, {
      ...aggregate,
      id: existing?.id ?? aggregate.id,
      createdAt: existing?.createdAt ?? aggregate.createdAt,
    });
  }
}

export function createAutoReplyEscalationNotification(
  message: Message,
  classification: Classification,
  settings: GuildSettings,
  reason: string,
): AdminNotification {
  const notificationType = notificationTypeFor(classification);
  const importance = classification.importance === "critical" ? "critical" : "high";
  return {
    id: newId(),
    notificationType,
    messageIds: [message.id],
    title: `自動返信エスカレーション: ${classification.labels.join(" / ")}`,
    body: [
      "自動返信ルールにより運営確認へ回した投稿です。",
      `チャンネル: ${message.channelName}`,
      `要点: ${classification.suggestedSummary}`,
      `理由: ${reason}`,
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
