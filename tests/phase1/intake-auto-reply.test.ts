import { describe, expect, it } from "vitest";

import { classifyMessage } from "../../src/app/classifier.js";
import { decideAutoReply } from "../../src/app/auto-reply.js";
import { normalizeSampleRecord, shouldIngestDiscordEvent } from "../../src/app/intake.js";
import { createDefaultAutoReplyPolicy, createDefaultSettings } from "../../src/app/settings.js";
import {
  readDiscordBotAuthorTestGate,
  shouldProcessDiscordMessage,
  validateDiscordBotAuthorTestGate,
  type DiscordBotAuthorTestGate,
} from "../../src/bot/message-filter.js";

const disabledBotAuthorGate: DiscordBotAuthorTestGate = {
  allowBotAuthors: false,
  allowedBotAuthorIds: [],
  curacuriEnv: undefined,
  nodeEnv: undefined,
};

describe("intake and auto reply boundaries", () => {
  it("keeps ordinary bot authors out of Discord ingestion", () => {
    expect(
      shouldProcessDiscordMessage(
        {
          author: { id: "bot-1", bot: true },
          content: "質問です",
        },
        disabledBotAuthorGate,
      ),
    ).toBe(false);
  });

  it("allows only explicit test bot authors outside production", () => {
    const gate = readDiscordBotAuthorTestGate({
      DISCORD_TEST_ALLOW_BOT_AUTHORS: "true",
      DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS: "tester-bot",
      CURACURI_ENV: "dogfood",
    });

    validateDiscordBotAuthorTestGate(gate);

    expect(
      shouldProcessDiscordMessage(
        {
          author: { id: "tester-bot", bot: true },
          content: "検証用の質問です",
        },
        gate,
      ),
    ).toBe(true);

    expect(
      shouldProcessDiscordMessage(
        {
          author: { id: "other-bot", bot: true },
          content: "検証用の質問です",
        },
        gate,
      ),
    ).toBe(false);
  });

  it("does not allow test bot authors in production environments", () => {
    const curacuriProductionGate = readDiscordBotAuthorTestGate({
      DISCORD_TEST_ALLOW_BOT_AUTHORS: "true",
      DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS: "tester-bot",
      CURACURI_ENV: "production",
    });
    const nodeProductionGate = readDiscordBotAuthorTestGate({
      DISCORD_TEST_ALLOW_BOT_AUTHORS: "true",
      DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS: "tester-bot",
      CURACURI_ENV: "dogfood",
      NODE_ENV: "production",
    });

    expect(() => {
      validateDiscordBotAuthorTestGate(curacuriProductionGate);
    }).toThrow("CURACURI_ENV=production");
    expect(() => {
      validateDiscordBotAuthorTestGate(nodeProductionGate);
    }).toThrow("NODE_ENV=production");

    expect(
      shouldProcessDiscordMessage(
        {
          author: { id: "tester-bot", bot: true },
          content: "検証用の質問です",
        },
        curacuriProductionGate,
      ),
    ).toBe(false);
  });

  it("requires explicit env and allowlist before accepting test bot authors", () => {
    const noAllowlistGate = readDiscordBotAuthorTestGate({
      DISCORD_TEST_ALLOW_BOT_AUTHORS: "true",
      CURACURI_ENV: "dogfood",
    });
    const noEnvironmentGate = readDiscordBotAuthorTestGate({
      DISCORD_TEST_ALLOW_BOT_AUTHORS: "true",
      DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS: "tester-bot",
    });

    expect(() => {
      validateDiscordBotAuthorTestGate(noAllowlistGate);
    }).toThrow("DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS");
    expect(() => {
      validateDiscordBotAuthorTestGate(noEnvironmentGate);
    }).toThrow("CURACURI_ENV");

    expect(
      shouldProcessDiscordMessage(
        {
          author: { id: "tester-bot", bot: true },
          content: "検証用の質問です",
        },
        noAllowlistGate,
      ),
    ).toBe(false);
  });

  it("keeps empty Discord messages out even for test bot authors", () => {
    const gate = readDiscordBotAuthorTestGate({
      DISCORD_TEST_ALLOW_BOT_AUTHORS: "true",
      DISCORD_TEST_ALLOWED_BOT_AUTHOR_IDS: "tester-bot",
      CURACURI_ENV: "dogfood",
    });

    expect(
      shouldProcessDiscordMessage(
        {
          author: { id: "tester-bot", bot: true },
          content: "   ",
        },
        gate,
      ),
    ).toBe(false);
  });

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
