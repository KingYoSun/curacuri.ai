import { newId, nowIso } from "./ids.js";
import {
  type AutoReply,
  type Classification,
  type FaqCandidate,
  type GuildSettings,
  type Message,
  type WeeklyReport,
  type WeeklyReportMetrics,
} from "../shared/types.js";

function countByLabel(classifications: readonly Classification[], label: string): number {
  return classifications.filter((classification) => classification.labels.includes(label as never))
    .length;
}

function topSummaries(
  classifications: readonly Classification[],
  limit: number,
): readonly string[] {
  return classifications
    .filter((classification) => classification.importance !== "low")
    .slice(0, limit)
    .map((classification) => classification.suggestedSummary);
}

function padList(items: readonly string[], fallback: string): readonly string[] {
  return items.length === 0 ? [fallback] : items;
}

export function buildWeeklyReportMetrics(
  classifications: readonly Classification[],
  faqCandidates: readonly FaqCandidate[],
  autoReplies: readonly AutoReply[],
): WeeklyReportMetrics {
  return {
    unansweredQuestionCount: countByLabel(classifications, "未回答質問"),
    bugReportCount: countByLabel(classifications, "バグ報告"),
    featureRequestCount: countByLabel(classifications, "要望"),
    complaintCount: countByLabel(classifications, "不満"),
    faqCandidateCount: faqCandidates.length,
    autoReplySentCount: autoReplies.filter((reply) => reply.status === "sent").length,
    autoReplyEscalatedCount: autoReplies.filter((reply) => reply.status === "escalated").length,
  };
}

export function buildWeeklyReport(
  periodStart: string,
  periodEnd: string,
  settings: GuildSettings,
  messages: readonly Message[],
  classifications: readonly Classification[],
  faqCandidates: readonly FaqCandidate[],
  autoReplies: readonly AutoReply[],
): WeeklyReport {
  const metrics = buildWeeklyReportMetrics(classifications, faqCandidates, autoReplies);
  const summaries = padList(
    topSummaries(classifications, 3),
    "要追加確認: 高重要度の投稿はありません。",
  );
  const channels = [...new Set(messages.map((message) => message.channelName))].join(", ");
  const excludedChannels =
    settings.excludedChannelIds.length === 0 ? "なし" : settings.excludedChannelIds.join(", ");
  const metricText = {
    messageCount: String(messages.length),
    unansweredQuestionCount: String(metrics.unansweredQuestionCount),
    bugReportCount: String(metrics.bugReportCount),
    featureRequestCount: String(metrics.featureRequestCount),
    complaintCount: String(metrics.complaintCount),
    faqCandidateCount: String(metrics.faqCandidateCount),
    autoReplySentCount: String(metrics.autoReplySentCount),
    autoReplyEscalatedCount: String(metrics.autoReplyEscalatedCount),
  };
  const mood =
    metrics.complaintCount > metrics.featureRequestCount
      ? "不満・戸惑いが相対的に目立ちます。断定せず運営確認を優先してください。"
      : "質問、要望、共有が中心で、週次確認に向いた状態です。";

  const shortBody = `# 今週のDiscord運営メモ

対象期間: ${periodStart}〜${periodEnd}
対象チャンネル: ${channels}
集計対象投稿数: ${metricText.messageCount}

## まず確認したいこと

${summaries.map((summary) => `- ${summary}`).join("\n")}

## 今週の主要トピック

1. 質問・未回答質問: ${metricText.unansweredQuestionCount}件
2. バグ報告候補: ${metricText.bugReportCount}件
3. FAQ候補: ${metricText.faqCandidateCount}件

## 見落とし防止メモ

- 未回答質問: ${metricText.unansweredQuestionCount}件
- バグ報告候補: ${metricText.bugReportCount}件
- 要望: ${metricText.featureRequestCount}件
- 不満・戸惑い: ${metricText.complaintCount}件
- FAQ候補: ${metricText.faqCandidateCount}件
- 自動返信: ${metricText.autoReplySentCount}件 / エスカレーション: ${metricText.autoReplyEscalatedCount}件

## 運営確認が必要そうな声

${summaries.map((summary) => `- ${summary}`).join("\n")}

## コミュニティ温度感

${mood}`;

  const detailedBody = `# 週次運営レポート

対象期間: ${periodStart}〜${periodEnd}
対象チャンネル: ${channels}
分析対象外チャンネル: ${excludedChannels}
集計対象投稿数: ${metricText.messageCount}

## 1. 要約

${mood}

## 2. 今週の主要トピック

| トピック | 概要 | 関連チャンネル | 運営確認 |
| --- | --- | --- | --- |
| 主要投稿 | ${summaries[0] ?? "要追加確認"} | ${channels} | 必要に応じて確認 |

## 3. 未回答質問

要追加確認: ${metricText.unansweredQuestionCount}件

## 4. 要望

${metricText.featureRequestCount}件

## 5. 不満・戸惑い

${metricText.complaintCount}件

## 6. バグ報告候補

${metricText.bugReportCount}件

## 7. 称賛・ポジティブ反応

${padList(
  classifications
    .filter((classification) => classification.labels.includes("称賛"))
    .slice(0, 3)
    .map((classification) => classification.suggestedSummary),
  "要追加確認",
)
  .map((item) => `- ${item}`)
  .join("\n")}

## 8. FAQ候補

${faqCandidates.map((candidate) => `- ${candidate.topic}`).join("\n") || "要追加確認"}

## 9. 運営確認が必要な話題

${summaries.map((summary) => `- ${summary}`).join("\n")}

## 10. 自動返信の動作メモ

送信 ${metricText.autoReplySentCount}件、エスカレーション ${metricText.autoReplyEscalatedCount}件。

## 11. 前週との差分

要追加確認

## 12. 次の推奨アクション

1. 高重要度の投稿を確認する。
2. FAQ候補を採用・却下・要確認に整理する。
3. 自動返信ログのフィードバックを確認する。`;

  return {
    id: newId(),
    periodStart,
    periodEnd,
    targetChannelIds: settings.targetChannelIds,
    excludedChannelIds: settings.excludedChannelIds,
    messageCount: messages.length,
    shortBody,
    detailedBody,
    metrics,
    status: "ready",
    createdAt: nowIso(),
  };
}
