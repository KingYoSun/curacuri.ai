import { afterEach, describe, expect, it, vi } from "vitest";

import { generateAutoReplyWithLlm } from "../../src/app/llm/generation.js";
import { normalizeSampleRecord } from "../../src/app/intake.js";
import { createDefaultAutoReplyPolicy, createDefaultSettings } from "../../src/app/settings.js";
import type { Phase1Repository } from "../../src/app/repositories/types.js";
import { createDiscordSender } from "../../src/bot/discord-sender.js";
import type {
  AdminNotification,
  AutoReply,
  Classification,
  Message,
} from "../../src/shared/types.js";
import { sendPendingNotifications } from "../../src/worker/notifications.js";
import { FakeLlmClient } from "./fake-llm.js";

class NotificationRepository implements Pick<
  Phase1Repository,
  | "listNotifications"
  | "saveNotification"
  | "claimPendingNotificationSend"
  | "markClaimedNotificationSent"
  | "markClaimedNotificationFailed"
> {
  readonly notifications = new Map<string, AdminNotification>();

  constructor(items: readonly AdminNotification[]) {
    for (const item of items) this.notifications.set(item.id, item);
  }

  listNotifications(): Promise<readonly AdminNotification[]> {
    return Promise.resolve([...this.notifications.values()]);
  }

  saveNotification(notification: AdminNotification): Promise<void> {
    this.notifications.set(notification.id, notification);
    return Promise.resolve();
  }

  claimPendingNotificationSend(id: string, claimToken: string): Promise<AdminNotification | null> {
    const notification = this.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== null) {
      return Promise.resolve(null);
    }
    const claimed = { ...notification, sentMessageId: claimToken };
    this.notifications.set(id, claimed);
    return Promise.resolve(claimed);
  }

  markClaimedNotificationSent(
    id: string,
    claimToken: string,
    sentMessageId: string,
  ): Promise<boolean> {
    const notification = this.notifications.get(id);
    if (notification?.sentMessageId !== claimToken) return Promise.resolve(false);
    this.notifications.set(id, {
      ...notification,
      status: "sent",
      sentMessageId,
      sentAt: "2026-05-25T00:00:00.000Z",
      failureReason: null,
    });
    return Promise.resolve(true);
  }

  markClaimedNotificationFailed(id: string, claimToken: string, reason: string): Promise<boolean> {
    const notification = this.notifications.get(id);
    if (notification?.sentMessageId !== claimToken) return Promise.resolve(false);
    this.notifications.set(id, {
      ...notification,
      status: "failed",
      sentMessageId: null,
      sentAt: null,
      failureReason: reason,
    });
    return Promise.resolve(true);
  }
}

function notification(): AdminNotification {
  return {
    id: "notification-1",
    notificationType: "official_reply",
    messageIds: ["message-1"],
    title: "確認が必要です",
    body: "公式回答が必要です。",
    importance: "high",
    status: "pending",
    sentToChannelId: "admin-channel",
    sentMessageId: null,
    sentAt: null,
    failureReason: null,
    createdAt: "2026-05-25T00:00:00.000Z",
  };
}

function classificationFor(message: Message, fields: Partial<Classification> = {}): Classification {
  return {
    id: "classification-1",
    messageId: message.id,
    labels: ["質問"],
    importance: "medium",
    adminActionNeeded: false,
    adminActionType: "weekly_report",
    confidence: 0.91,
    reason: "使い方を確認している投稿のため。",
    suggestedSummary: "使い方に関する質問。",
    modelName: "test",
    rawOutput: {},
    createdAt: "2026-05-25T00:00:00.000Z",
    ...fields,
  };
}

function autoReplyFor(message: Message, classification: Classification): AutoReply {
  return {
    id: "auto-reply-1",
    messageId: message.id,
    classificationId: classification.id,
    mode: "intake_only",
    replyCategory: "intake",
    body: "受け付けました。",
    sourceRefs: [],
    confidence: 0.91,
    decisionReason: "受付返信として安全な範囲のため。",
    status: "drafted",
    sentMessageId: null,
    approvedBy: null,
    sentAt: null,
    createdAt: "2026-05-25T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Discord dry-run boundaries", () => {
  it("marks pending admin notifications sent with dry-run message ids", async () => {
    vi.stubEnv("DISCORD_DRY_RUN", "true");
    const repository = new NotificationRepository([notification()]);

    await sendPendingNotifications(repository, createDiscordSender());

    expect(repository.notifications.get("notification-1")).toMatchObject({
      status: "sent",
      sentMessageId: "dry-run:notification-1",
      failureReason: null,
    });
  });

  it("returns dry-run message ids for auto reply sends", async () => {
    vi.stubEnv("DISCORD_DRY_RUN", "true");
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const classification = classificationFor(message);

    await expect(
      createDiscordSender().sendAutoReply(autoReplyFor(message, classification), message),
    ).resolves.toEqual({ sentMessageId: "dry-run:auto-reply-1" });
  });

  it("does not produce sendable auto replies when disabled", async () => {
    const settings = createDefaultSettings();
    const policy = createDefaultAutoReplyPolicy(settings);
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );

    const result = await generateAutoReplyWithLlm(
      message,
      classificationFor(message),
      policy,
      [],
      new FakeLlmClient(),
    );

    expect(result.autoReply).toMatchObject({
      status: "blocked",
      sentMessageId: null,
      decisionReason: "自動返信は無効です。",
    });
    expect(result.run).toBeNull();
  });

  it("keeps high and official-needed replies out of Discord sends", async () => {
    const settings = createDefaultSettings();
    const policy = {
      ...createDefaultAutoReplyPolicy(settings),
      enabled: true,
      mode: "intake_only" as const,
      allowedChannelIds: ["support"],
    };
    const message = normalizeSampleRecord(
      {
        text: "無料プランは来月で全部終了って本当ですか？",
        channel_context: "#support / 料金質問",
      },
      0,
    );

    const result = await generateAutoReplyWithLlm(
      message,
      classificationFor(message, {
        labels: ["質問", "公式回答待ち"],
        importance: "high",
        adminActionNeeded: true,
        adminActionType: "reply_check",
      }),
      policy,
      [],
      new FakeLlmClient(),
    );

    expect(result.autoReply).toMatchObject({
      status: "escalated",
      sentMessageId: null,
    });
    expect(result.run).toBeNull();
  });
});
