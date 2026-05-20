import { describe, expect, it } from "vitest";

import { classifyMessage } from "../../src/app/classifier.js";
import { decideAutoReply } from "../../src/app/auto-reply.js";
import { normalizeSampleRecord, shouldIngestDiscordEvent } from "../../src/app/intake.js";
import { createDefaultAutoReplyPolicy, createDefaultSettings } from "../../src/app/settings.js";

describe("intake and auto reply boundaries", () => {
  it("filters DM and excluded channels", () => {
    const settings = {
      ...createDefaultSettings(),
      targetChannelIds: ["support"],
      excludedChannelIds: ["internal"],
    };

    expect(
      shouldIngestDiscordEvent(
        {
          guildId: null,
          channelId: "support",
          channelName: "#support",
          messageId: "1",
          authorId: "user",
          content: "質問です",
          postedAt: new Date().toISOString(),
          isDm: true,
        },
        settings,
      ),
    ).toBe(false);

    expect(
      shouldIngestDiscordEvent(
        {
          guildId: "guild",
          channelId: "internal",
          channelName: "#internal",
          messageId: "2",
          authorId: "user",
          content: "質問です",
          postedAt: new Date().toISOString(),
          isDm: false,
        },
        settings,
      ),
    ).toBe(false);
  });

  it("does not send user-facing replies when disabled", () => {
    const settings = createDefaultSettings();
    const policy = createDefaultAutoReplyPolicy(settings);
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const classification = classifyMessage(message);

    expect(decideAutoReply(message, classification, policy, [])).toMatchObject({
      status: "blocked",
    });
  });

  it("requires source refs in faq_assist mode", () => {
    const settings = createDefaultSettings();
    const policy = {
      ...createDefaultAutoReplyPolicy(settings),
      enabled: true,
      mode: "faq_assist" as const,
    };
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const classification = classifyMessage(message);

    expect(decideAutoReply(message, classification, policy, [])).toMatchObject({
      status: "escalated",
      decisionReason: "FAQ補助に必要な参照元がありません。",
    });
  });

  it("creates approval drafts without sending", () => {
    const settings = createDefaultSettings();
    const policy = {
      ...createDefaultAutoReplyPolicy(settings),
      enabled: true,
      mode: "approval_required" as const,
    };
    const message = normalizeSampleRecord(
      {
        text: "はじめて来ました。質問はsupportとdev-helpのどちらですか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    const classification = classifyMessage(message);

    expect(decideAutoReply(message, classification, policy, [])).toMatchObject({
      status: "pending_approval",
      sentMessageId: null,
    });
  });
});
