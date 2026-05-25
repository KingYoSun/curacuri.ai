import { describe, expect, it } from "vitest";

import {
  buildAutoReplyMessages,
  buildFaqCandidateMessages,
  buildWeeklyReportMessages,
} from "../../src/app/llm/prompts.js";
import { createDefaultAutoReplyPolicy, createDefaultSettings } from "../../src/app/settings.js";
import type { Classification, Message } from "../../src/shared/types.js";

const settings = createDefaultSettings();

const message: Message = {
  id: "message-1",
  source: "sample_log",
  guildId: settings.guildId,
  channelId: "support",
  channelName: "#support",
  messageId: "discord-message-1",
  threadId: null,
  authorIdHash: "author-1",
  content: "Webhook通知の設定ってどこからできますか？",
  postedAt: "2026-05-25T00:00:00.000Z",
  ingestedAt: "2026-05-25T00:00:00.000Z",
  deletedAt: null,
};

const classification: Classification = {
  id: "classification-1",
  messageId: message.id,
  labels: ["質問"],
  importance: "medium",
  adminActionNeeded: false,
  adminActionType: "weekly_report",
  confidence: 0.91,
  reason: "使い方を確認している投稿のため。",
  suggestedSummary: "Webhook通知設定の質問。",
  modelName: "test",
  rawOutput: {},
  createdAt: "2026-05-25T00:00:00.000Z",
};

function systemPrompt(messages: ReturnType<typeof buildAutoReplyMessages>): string {
  const content = messages[0]?.content;
  return typeof content === "string" ? content : "";
}

describe("LLM prompt quality guardrails", () => {
  it("keeps auto replies short, safe, and non-official", () => {
    const prompt = systemPrompt(
      buildAutoReplyMessages(message, classification, createDefaultAutoReplyPolicy(settings), []),
    );

    expect(prompt).toContain("1〜3文");
    expect(prompt).toContain("断定");
    expect(prompt).toContain("未確認の手順追加");
    expect(prompt).toContain("あなたの返信は公式回答ではありません");
  });

  it("asks FAQ generation to merge near-duplicate questions and skip weak material", () => {
    const prompt = systemPrompt(buildFaqCandidateMessages([message], [classification]));

    expect(prompt).toContain("同じ質問や近い論点は1候補へまとめ");
    expect(prompt).toContain("1候補は1つの質問");
    expect(prompt).toContain("根拠の薄い推測はFAQ候補にしない");
  });

  it("caps the short weekly report to a five-minute review shape", () => {
    const prompt = systemPrompt(
      buildWeeklyReportMessages(
        "2026-05-18",
        "2026-05-24",
        settings,
        [message],
        [classification],
        [],
        {
          unansweredQuestionCount: 1,
          bugReportCount: 0,
          featureRequestCount: 0,
          complaintCount: 0,
          faqCandidateCount: 0,
          autoReplySentCount: 0,
          autoReplyEscalatedCount: 0,
        },
      ),
    );

    expect(prompt).toContain("短い版は最大5項目");
    expect(prompt).toContain("各項目は1〜2文");
    expect(prompt).toContain("詳細な根拠や全文引用は詳細版");
  });
});
