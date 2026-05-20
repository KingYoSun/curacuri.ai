import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { classifyMessage } from "../../src/app/classifier.js";
import { normalizeSampleRecord } from "../../src/app/intake.js";
import { classificationLabels } from "../../src/shared/types.js";
import { parseClassificationOutputJson } from "../../src/shared/validation.js";

describe("classification contracts", () => {
  it("matches the label taxonomy document", async () => {
    const doc = await readFile("docs/classification/label-taxonomy-v0.md", "utf8");
    const labelsBlock = /## ラベル一覧\s+```text\s+(?<labels>[\s\S]+?)```/u.exec(doc)?.groups
      ?.labels;

    expect(labelsBlock?.trim().split("\n")).toEqual([...classificationLabels]);
  });

  it("validates a classification output JSON object", () => {
    expect(
      parseClassificationOutputJson(
        JSON.stringify({
          labels: ["質問"],
          importance: "medium",
          admin_action_needed: false,
          admin_action_type: "weekly_report",
          confidence: 0.91,
          reason: "使い方を尋ねている投稿のため。",
          suggested_summary: "Webhook通知設定の場所を確認したい。",
        }),
      ),
    ).toMatchObject({
      labels: ["質問"],
      importance: "medium",
    });
  });

  it("rejects empty labels", () => {
    expect(() =>
      parseClassificationOutputJson(
        JSON.stringify({
          labels: [],
          importance: "medium",
          admin_action_needed: false,
          admin_action_type: "weekly_report",
          confidence: 0.91,
          reason: "使い方を尋ねている投稿のため。",
          suggested_summary: "Webhook通知設定の場所を確認したい。",
        }),
      ),
    ).toThrow(/labels/u);
  });

  it("classifies high-risk official topics for admin confirmation", () => {
    const message = normalizeSampleRecord(
      {
        text: "無料プランは来月で全部終了って聞いたんですが本当ですか？",
        channel_context: "#general / 料金に関する会話",
      },
      0,
    );

    const classification = classifyMessage(message);

    expect(classification.labels).toEqual(
      expect.arrayContaining(["質問", "公式回答待ち", "誤情報可能性"]),
    );
    expect(classification.importance).toBe("high");
    expect(classification.adminActionNeeded).toBe(true);
  });
});
