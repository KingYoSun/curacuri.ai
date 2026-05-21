import { describe, expect, it } from "vitest";

import { OpenAICompatibleLlmClient } from "../../src/app/llm/client.js";
import { normalizeSampleRecord } from "../../src/app/intake.js";
import { createPhase1State } from "../../src/app/store.js";
import {
  generateWeeklyReport,
  processMessage,
  refreshFaqCandidates,
  reprocessLlmTask,
  retryLlmRun,
} from "../../src/app/workflow.js";
import { FakeLlmClient } from "./fake-llm.js";

describe("LLM workflow", () => {
  it("records a failed run when LLM config is missing", async () => {
    const state = createPhase1State();
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(
      state,
      message,
      new OpenAICompatibleLlmClient({
        apiKey: null,
        baseUrl: "https://api.openai.com/v1",
        model: null,
        timeoutMs: 1000,
        concurrency: 1,
        responseFormat: "json_object",
      }),
    );

    expect([...state.llmGenerationRuns.values()]).toEqual([
      expect.objectContaining({
        taskType: "classification",
        status: "failed",
        errorCode: "llm_api_key_missing",
      }),
    ]);
    expect(state.classifications.size).toBe(0);
  });

  it("records validation failures for invalid classification output", async () => {
    const state = createPhase1State();
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(
      state,
      message,
      new FakeLlmClient({
        overrides: {
          classification: {
            labels: [],
            importance: "medium",
            admin_action_needed: false,
            admin_action_type: "weekly_report",
            confidence: 0.91,
            reason: "不正な出力",
            suggested_summary: "不正な出力",
          },
        },
      }),
    );

    expect([...state.llmGenerationRuns.values()][0]).toMatchObject({
      taskType: "classification",
      status: "failed",
    });
  });

  it("blocks high-risk auto replies even when LLM would send", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["support"],
    };
    const message = normalizeSampleRecord(
      {
        text: "無料プランは来月で全部終了って本当ですか？",
        channel_context: "#support / 料金質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(
      state,
      message,
      new FakeLlmClient({
        overrides: {
          classification: {
            labels: ["質問", "公式回答待ち"],
            importance: "high",
            admin_action_needed: true,
            admin_action_type: "reply_check",
            confidence: 0.91,
            reason: "料金に関する公式確認が必要なため。",
            suggested_summary: "料金に関する公式確認が必要な質問。",
          },
        },
      }),
    );

    expect([...state.autoReplies.values()][0]).toMatchObject({
      status: "escalated",
      sentMessageId: null,
    });
  });

  it("creates admin notifications for notify_admin escalation rules", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["support"],
      escalationRules: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          guildId: state.settings.guildId,
          ruleType: "keyword",
          condition: { keywords: ["社外秘"] },
          action: "notify_admin",
          enabled: true,
          createdAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    };
    const message = normalizeSampleRecord(
      {
        text: "社外秘の設定ですが、Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(state, message, new FakeLlmClient());

    expect([...state.autoReplies.values()][0]).toMatchObject({
      status: "escalated",
      sentMessageId: null,
    });
    const notification = [...state.notifications.values()][0];
    expect(notification?.title).toContain("自動返信エスカレーション");
    expect(notification?.status).toBe("pending");
  });

  it("holds replies for approval when draft_for_approval escalation rules match", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["support"],
      escalationRules: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          guildId: state.settings.guildId,
          ruleType: "keyword",
          condition: { keywords: ["確認してから"] },
          action: "draft_for_approval",
          enabled: true,
          createdAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    };
    const message = normalizeSampleRecord(
      {
        text: "確認してから返信したいです。Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(state, message, new FakeLlmClient());

    expect([...state.autoReplies.values()][0]).toMatchObject({
      status: "pending_approval",
      sentMessageId: null,
    });
  });

  it("blocks replies when do_not_reply escalation rules match", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["support"],
      escalationRules: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          guildId: state.settings.guildId,
          ruleType: "keyword",
          condition: { keywords: ["返信不要"] },
          action: "do_not_reply",
          enabled: true,
          createdAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    };
    const message = normalizeSampleRecord(
      {
        text: "返信不要ですが、Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(state, message, new FakeLlmClient());

    expect([...state.autoReplies.values()][0]).toMatchObject({
      status: "blocked",
      body: "",
      sentMessageId: null,
    });
  });

  it("ignores disabled escalation rules", async () => {
    const state = createPhase1State();
    state.autoReplyPolicy = {
      ...state.autoReplyPolicy,
      enabled: true,
      mode: "intake_only",
      allowedChannelIds: ["support"],
      escalationRules: [
        {
          id: "00000000-0000-4000-8000-000000000004",
          guildId: state.settings.guildId,
          ruleType: "keyword",
          condition: { keywords: ["返信不要"] },
          action: "do_not_reply",
          enabled: false,
          createdAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      ],
    };
    const message = normalizeSampleRecord(
      {
        text: "返信不要という語はありますが、Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await processMessage(state, message, new FakeLlmClient());

    expect([...state.autoReplies.values()][0]).toMatchObject({
      status: "sent",
    });
  });

  it("retries a failed classification run", async () => {
    const state = createPhase1State();
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);
    await processMessage(state, message, new FakeLlmClient({ failures: ["classification"] }));
    const failedRun = [...state.llmGenerationRuns.values()][0];

    expect(failedRun).toBeDefined();
    if (failedRun !== undefined) {
      await retryLlmRun(state, failedRun.id, new FakeLlmClient());
    }

    expect(state.classifications.size).toBe(1);
    expect([...state.llmGenerationRuns.values()].some((run) => run.status === "succeeded")).toBe(
      true,
    );
  });

  it("reprocesses all LLM tasks through weekly report", async () => {
    const state = createPhase1State();
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);

    await reprocessLlmTask(
      state,
      "all",
      new FakeLlmClient({
        overrides: {
          faq_candidates: {
            candidates: [
              {
                source_message_ids: [message.id],
                topic: "Webhook設定",
                current_answer_status: "existing_faq_possible",
                draft_question: "Webhook設定はどこで確認できますか？",
                draft_answer: "この回答文案は公式回答ではありません。",
                confidence: 0.82,
                status: "candidate",
              },
            ],
          },
        },
      }),
    );
    const report = await generateWeeklyReport(
      state,
      "2026-01-01",
      "2026-01-07",
      new FakeLlmClient(),
    );

    expect(state.classifications.size).toBe(1);
    expect(state.faqCandidates.size).toBeGreaterThan(0);
    expect(report?.status).toBe("ready");
  });

  it("keeps existing FAQ candidates when LLM FAQ generation fails", async () => {
    const state = createPhase1State();
    const message = normalizeSampleRecord(
      {
        text: "Webhook通知の設定ってどこからできますか？",
        channel_context: "#support / 使い方質問",
      },
      0,
    );
    state.messages.set(message.id, message);
    await processMessage(state, message, new FakeLlmClient());
    await refreshFaqCandidates(
      state,
      new FakeLlmClient({
        overrides: {
          faq_candidates: {
            candidates: [
              {
                source_message_ids: [message.id],
                topic: "Webhook設定",
                current_answer_status: "existing_faq_possible",
                draft_question: "Webhook設定はどこで確認できますか？",
                draft_answer: "この回答文案は公式回答ではありません。",
                confidence: 0.82,
                status: "candidate",
              },
            ],
          },
        },
      }),
    );
    const existingCandidates = [...state.faqCandidates.values()];

    await refreshFaqCandidates(state, new FakeLlmClient({ failures: ["faq_candidates"] }));

    expect([...state.faqCandidates.values()]).toEqual(existingCandidates);
    expect([...state.llmGenerationRuns.values()].at(-1)).toMatchObject({
      taskType: "faq_candidates",
      status: "failed",
    });
  });
});
