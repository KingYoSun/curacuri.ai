import { describe, expect, it } from "vitest";

import { createPhase1State } from "../../src/app/store.js";
import { generateWeeklyReport, importSampleLog, recordFeedback } from "../../src/app/workflow.js";

describe("sample log workflow", () => {
  it("imports sample logs and produces classifications, notifications, FAQs, and a weekly report", async () => {
    const state = createPhase1State();

    const result = await importSampleLog(state);
    const report = generateWeeklyReport(state, "2026-01-01", "2026-01-07");
    const firstNotification = [...state.notifications.values()][0];
    const firstFaq = [...state.faqCandidates.values()][0];

    expect(result.imported).toBeGreaterThan(0);
    expect(state.messages.size).toBe(result.imported);
    expect(state.classifications.size).toBe(result.imported);
    expect(state.notifications.size).toBeGreaterThan(0);
    expect(state.faqCandidates.size).toBeGreaterThan(0);
    expect(report.status).toBe("ready");
    expect(report.shortBody).toContain("まず確認したいこと");
    expect(report.detailedBody).toContain("## 12. 次の推奨アクション");

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
