import { describe, expect, it } from "vitest";

import { createPhase1State } from "../../src/app/store.js";
import { generateWeeklyReport, importSampleLog, recordFeedback } from "../../src/app/workflow.js";
import { FakeLlmClient } from "./fake-llm.js";

describe("sample log workflow", () => {
  it("imports sample logs and produces classifications, notifications, FAQs, and a weekly report", async () => {
    const state = createPhase1State();
    const client = new FakeLlmClient({
      overrides: {
        classification: {
          labels: ["質問", "公式回答待ち"],
          importance: "high",
          admin_action_needed: true,
          admin_action_type: "reply_check",
          confidence: 0.91,
          reason: "公式確認が必要そうな質問のため。",
          suggested_summary: "公式確認が必要そうな質問。",
        },
      },
    });

    const result = await importSampleLog(state, undefined, client);
    const firstMessage = [...state.messages.values()][0];
    const faqSourceId = firstMessage?.id ?? "";
    const report = await generateWeeklyReport(
      state,
      "2026-01-01",
      "2026-01-07",
      new FakeLlmClient({
        overrides: {
          faq_candidates: {
            candidates: [
              {
                source_message_ids: [faqSourceId],
                topic: "公式確認が必要な質問",
                current_answer_status: "needs_official_answer",
                draft_question: "公式確認が必要な質問はどこで確認できますか？",
                draft_answer: "この回答文案は公式回答ではありません。",
                confidence: 0.82,
                status: "needs_review",
              },
            ],
          },
        },
      }),
    );
    const firstNotification = [...state.notifications.values()][0];
    const firstFaq = [...state.faqCandidates.values()][0];

    expect(result.imported).toBeGreaterThan(0);
    expect(state.messages.size).toBe(result.imported);
    expect(state.classifications.size).toBe(result.imported);
    expect(state.notifications.size).toBeGreaterThan(0);
    expect(state.faqCandidates.size).toBeGreaterThan(0);
    expect(report?.status).toBe("ready");
    expect(report?.shortBody).toContain("まず確認したいこと");
    expect(report?.detailedBody).toContain("## 12. 次の推奨アクション");

    expect(firstNotification).toBeDefined();
    if (firstNotification !== undefined) {
      expect(
        recordFeedback(state, "notification", firstNotification.id, "useful", "確認済み"),
      ).toMatchObject({ targetType: "notification" });
    }

    expect(firstFaq).toBeDefined();
    if (firstFaq !== undefined) {
      expect(recordFeedback(state, "faq_candidate", firstFaq.id, "useful", "候補")).toMatchObject({
        targetType: "faq_candidate",
      });
    }
  });
});
