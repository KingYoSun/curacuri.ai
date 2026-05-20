import type { LlmClient, LlmJsonRequest, LlmJsonResult } from "../../src/app/llm/client.js";

export class FakeLlmClient implements LlmClient {
  readonly modelName = "fake-llm";

  private readonly overrides: Partial<Record<LlmJsonRequest["taskType"], Record<string, unknown>>>;
  private readonly failures: Set<LlmJsonRequest["taskType"]>;

  constructor(
    fields: {
      readonly overrides?: Partial<Record<LlmJsonRequest["taskType"], Record<string, unknown>>>;
      readonly failures?: readonly LlmJsonRequest["taskType"][];
    } = {},
  ) {
    this.overrides = fields.overrides ?? {};
    this.failures = new Set(fields.failures ?? []);
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    await Promise.resolve();
    if (this.failures.has(request.taskType)) {
      throw new Error(`${request.taskType} failed`);
    }
    const rawJson = this.overrides[request.taskType] ?? defaultOutput(request.taskType);
    return {
      modelName: this.modelName,
      rawText: JSON.stringify(rawJson),
      rawJson,
    };
  }
}

function defaultOutput(taskType: LlmJsonRequest["taskType"]): Record<string, unknown> {
  if (taskType === "classification") {
    return {
      labels: ["質問"],
      importance: "medium",
      admin_action_needed: false,
      admin_action_type: "weekly_report",
      confidence: 0.91,
      reason: "使い方を確認している投稿のため。",
      suggested_summary: "使い方に関する質問。",
    };
  }
  if (taskType === "auto_reply") {
    return {
      decision: "send",
      reply_category: "intake",
      body: "クラクリAIです。投稿を記録しました。必要に応じて運営確認に回します。",
      source_ref_ids: [],
      confidence: 0.91,
      reason: "受付返信として安全な範囲のため。",
      escalation_reason: "none",
    };
  }
  if (taskType === "faq_candidates") {
    return {
      candidates: [
        {
          source_message_ids: [],
          topic: "使い方の確認",
          current_answer_status: "existing_faq_possible",
          draft_question: "基本的な使い方はどこで確認できますか？",
          draft_answer: "この回答文案は公式回答ではありません。運営確認後にFAQ化してください。",
          confidence: 0.82,
          status: "candidate",
        },
      ],
    };
  }
  return {
    short_body: "# 今週のDiscord運営メモ\n\n## まず確認したいこと\n\n- 要追加確認",
    detailed_body: "# 週次運営レポート\n\n## 12. 次の推奨アクション\n\n1. 要追加確認",
  };
}
