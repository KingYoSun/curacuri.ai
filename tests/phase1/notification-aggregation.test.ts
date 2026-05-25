import { describe, expect, it } from "vitest";

import {
  createAggregateAdminNotifications,
  upsertAggregateAdminNotifications,
} from "../../src/app/notifications.js";
import { normalizeSampleRecord } from "../../src/app/intake.js";
import { createDefaultSettings } from "../../src/app/settings.js";
import type { AdminNotification, Classification, Message } from "../../src/shared/types.js";

function classificationFor(message: Message, fields: Partial<Classification> = {}): Classification {
  return {
    id: `classification-${message.id}`,
    messageId: message.id,
    labels: ["質問"],
    importance: "medium",
    adminActionNeeded: false,
    adminActionType: "weekly_report",
    confidence: 0.9,
    reason: "確認対象の投稿です。",
    suggestedSummary: "確認対象の投稿。",
    modelName: "test",
    rawOutput: {},
    createdAt: "2026-05-25T00:00:00.000Z",
    ...fields,
  };
}

function messageAt(index: number, postedAt: string, text = "確認したいです。"): Message {
  return {
    ...normalizeSampleRecord(
      {
        text,
        channel_context: "#support / 確認",
      },
      index,
    ),
    postedAt,
    authorIdHash: `author-${String(index)}`,
  };
}

describe("notification aggregation", () => {
  it("creates a bug cluster notification when multiple users report bugs", () => {
    const settings = createDefaultSettings();
    const messages = [
      messageAt(1, "2026-05-24T12:00:00.000Z", "保存するとエラーになります。"),
      messageAt(2, "2026-05-24T13:00:00.000Z", "同じく保存エラーが出ます。"),
    ];
    const classifications = messages.map((message) =>
      classificationFor(message, {
        labels: ["バグ報告"],
        adminActionNeeded: true,
        adminActionType: "bug_triage",
        suggestedSummary: "保存エラーの報告。",
      }),
    );

    const notifications = createAggregateAdminNotifications(
      messages,
      classifications,
      settings,
      new Date("2026-05-25T00:00:00.000Z"),
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        notificationType: "bug_cluster",
        title: "集約: 複数ユーザーの不具合報告",
        messageIds: messages.map((message) => message.id),
      }),
    ]);
  });

  it("detects old unanswered questions and refreshes existing pending aggregate notifications", () => {
    const settings = createDefaultSettings();
    const oldQuestion = messageAt(1, "2026-05-23T12:00:00.000Z", "料金はどこで確認できますか？");
    const oldClassification = classificationFor(oldQuestion, {
      labels: ["質問", "未回答質問"],
      adminActionNeeded: true,
      adminActionType: "reply_check",
      suggestedSummary: "料金確認の質問。",
    });
    const current = new Map<string, AdminNotification>([
      [
        "notification-1",
        {
          id: "notification-1",
          notificationType: "unanswered_question",
          messageIds: ["old-message"],
          title: "集約: 昨日以前の未回答質問",
          body: "古い通知",
          importance: "high",
          status: "pending",
          sentToChannelId: settings.adminNotificationChannelId,
          sentMessageId: null,
          sentAt: null,
          failureReason: null,
          createdAt: "2026-05-24T00:00:00.000Z",
        },
      ],
    ]);

    const aggregate = createAggregateAdminNotifications(
      [oldQuestion],
      [oldClassification],
      settings,
      new Date("2026-05-25T00:00:00.000Z"),
    );
    upsertAggregateAdminNotifications(current, aggregate);

    expect(current.get("notification-1")).toMatchObject({
      id: "notification-1",
      notificationType: "unanswered_question",
      messageIds: [oldQuestion.id],
      status: "pending",
      createdAt: "2026-05-24T00:00:00.000Z",
    });
  });
});
