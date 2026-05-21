import { describe, expect, it } from "vitest";

import type { Phase1Repository } from "../../src/app/repositories/types.js";
import type { DiscordSender } from "../../src/bot/discord-sender.js";
import { notificationSendClaimPrefix } from "../../src/shared/notifications.js";
import type { AdminNotification } from "../../src/shared/types.js";
import { sendPendingNotifications } from "../../src/worker/notifications.js";

type NotificationRepository = Pick<
  Phase1Repository,
  | "listNotifications"
  | "saveNotification"
  | "claimPendingNotificationSend"
  | "markClaimedNotificationSent"
  | "markClaimedNotificationFailed"
>;

class MemoryNotificationRepository implements NotificationRepository {
  readonly notifications = new Map<string, AdminNotification>();

  constructor(notifications: readonly AdminNotification[]) {
    for (const notification of notifications) {
      this.notifications.set(notification.id, notification);
    }
  }

  listNotifications(): Promise<readonly AdminNotification[]> {
    return Promise.resolve([...this.notifications.values()]);
  }

  saveNotification(notification: AdminNotification): Promise<void> {
    const existing = this.notifications.get(notification.id);
    if (
      existing !== undefined &&
      (existing.status !== "pending" || existing.sentMessageId !== null)
    ) {
      return Promise.resolve();
    }
    this.notifications.set(notification.id, notification);
    return Promise.resolve();
  }

  claimPendingNotificationSend(id: string, claimToken: string): Promise<AdminNotification | null> {
    const notification = this.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== null) {
      return Promise.resolve(null);
    }
    const claimed = { ...notification, sentMessageId: claimToken, failureReason: null };
    this.notifications.set(id, claimed);
    return Promise.resolve(claimed);
  }

  markClaimedNotificationSent(
    id: string,
    claimToken: string,
    sentMessageId: string,
  ): Promise<boolean> {
    const notification = this.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== claimToken) {
      return Promise.resolve(false);
    }
    this.notifications.set(id, {
      ...notification,
      status: "sent",
      sentMessageId,
      sentAt: "2026-05-21T00:00:00.000Z",
      failureReason: null,
    });
    return Promise.resolve(true);
  }

  markClaimedNotificationFailed(id: string, claimToken: string, reason: string): Promise<boolean> {
    const notification = this.notifications.get(id);
    if (notification?.status !== "pending" || notification.sentMessageId !== claimToken) {
      return Promise.resolve(false);
    }
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

function notification(fields: Partial<AdminNotification> = {}): AdminNotification {
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
    createdAt: "2026-05-21T00:00:00.000Z",
    ...fields,
  };
}

function sender(sendAdminNotification: DiscordSender["sendAdminNotification"]): DiscordSender {
  return {
    sendAdminNotification,
    sendAutoReply() {
      return Promise.reject(new Error("unsupported in this test"));
    },
  };
}

describe("worker notification sending", () => {
  it("sends the same pending notification once across parallel workers", async () => {
    const repository = new MemoryNotificationRepository([notification()]);
    let sendCount = 0;

    await Promise.all([
      sendPendingNotifications(
        repository,
        sender((item) => {
          sendCount += 1;
          return Promise.resolve({ sentMessageId: `discord:${item.id}` });
        }),
      ),
      sendPendingNotifications(
        repository,
        sender((item) => {
          sendCount += 1;
          return Promise.resolve({ sentMessageId: `discord:${item.id}` });
        }),
      ),
    ]);

    expect(sendCount).toBe(1);
    expect(repository.notifications.get("notification-1")).toMatchObject({
      status: "sent",
      sentMessageId: "discord:notification-1",
      failureReason: null,
    });
  });

  it("does not resend a claimed pending notification", async () => {
    const repository = new MemoryNotificationRepository([
      notification({ sentMessageId: `${notificationSendClaimPrefix}existing` }),
    ]);
    let sendCount = 0;

    await sendPendingNotifications(
      repository,
      sender((item) => {
        sendCount += 1;
        return Promise.resolve({ sentMessageId: `discord:${item.id}` });
      }),
    );

    expect(sendCount).toBe(0);
    expect(repository.notifications.get("notification-1")).toMatchObject({
      status: "pending",
      sentMessageId: `${notificationSendClaimPrefix}existing`,
    });
  });

  it("marks a claimed notification failed and clears the claim token when sending fails", async () => {
    const repository = new MemoryNotificationRepository([notification()]);

    await sendPendingNotifications(
      repository,
      sender(() => Promise.reject(new Error("Discord API failed: 500"))),
    );

    expect(repository.notifications.get("notification-1")).toMatchObject({
      status: "failed",
      sentMessageId: null,
      sentAt: null,
      failureReason: "Discord API failed: 500",
    });
  });

  it("does not let a stale snapshot save roll a sent notification back to pending", async () => {
    const repository = new MemoryNotificationRepository([
      notification({
        status: "sent",
        sentMessageId: "discord:notification-1",
        sentAt: "2026-05-21T00:00:00.000Z",
      }),
    ]);

    await repository.saveNotification(notification({ status: "pending", sentMessageId: null }));

    expect(repository.notifications.get("notification-1")).toMatchObject({
      status: "sent",
      sentMessageId: "discord:notification-1",
    });
  });
});
