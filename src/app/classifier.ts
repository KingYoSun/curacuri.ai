import { buildClassification } from "../shared/validation.js";
import { newId, nowIso } from "./ids.js";
import {
  type AdminActionType,
  type Classification,
  type ClassificationLabel,
  type Importance,
  type Message,
} from "../shared/types.js";

type DraftClassification = {
  readonly labels: readonly ClassificationLabel[];
  readonly importance: Importance;
  readonly adminActionNeeded: boolean;
  readonly adminActionType: AdminActionType;
  readonly confidence: number;
  readonly reason: string;
  readonly suggestedSummary: string;
};

function includesAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

function uniqueLabels(labels: readonly ClassificationLabel[]): readonly ClassificationLabel[] {
  return [...new Set(labels)];
}

function labelsForMessage(message: Message): readonly ClassificationLabel[] {
  const text = message.content;
  const labels: ClassificationLabel[] = [];

  if (/[？?]/u.test(text) || includesAny(text, ["どこ", "ありますか", "でしょうか", "ですか"])) {
    labels.push("質問");
  }
  if (includesAny(text, ["昨日", "まだ回答", "返信がない", "未回答"])) {
    labels.push("未回答質問");
  }
  if (
    includesAny(text, [
      "料金",
      "無料プラン",
      "障害",
      "仕様",
      "ロードマップ",
      "商用利用",
      "リージョン",
      "公式",
      "告知",
      "規約",
      "保存期間",
      "ソースが見つかりません",
    ])
  ) {
    labels.push("公式回答待ち");
  }
  if (
    includesAny(text, [
      "500",
      "401",
      "429",
      "失敗",
      "壊",
      "エラー",
      "真っ白",
      "返って",
      "文字化け",
      "ログインでき",
      "届きません",
      "空配列",
      "404",
    ])
  ) {
    labels.push("バグ報告");
  }
  if (
    includesAny(text, [
      "ほしい",
      "欲しい",
      "できると",
      "してほしい",
      "改善",
      "固定",
      "入れてもよさそう",
      "案内が欲しい",
    ])
  ) {
    labels.push("要望");
  }
  if (
    includesAny(text, [
      "しんどい",
      "怖い",
      "不安",
      "つらい",
      "信用しづらい",
      "前の方がよかった",
      "置いていかれて",
      "放置",
      "後出し",
    ])
  ) {
    labels.push("不満");
  }
  if (
    includesAny(text, [
      "助か",
      "良い",
      "よかった",
      "速く",
      "すごい",
      "ありがとうございます",
      "便利",
      "ありがたい",
      "分かりやす",
    ])
  ) {
    labels.push("称賛");
  }
  if (includesAny(text, ["憶測", "本当ですか", "らしい", "聞いた", "どちらが最新", "非公式"])) {
    labels.push("誤情報可能性");
  }
  if (
    includesAny(text, ["また告知なし", "また同じ障害", "公式が何も言わない", "運営を信用", "不信"])
  ) {
    labels.push("炎上兆候");
  }
  if (
    includesAny(text, [
      "APIキー",
      "トークン",
      "メールアドレス",
      "宣伝",
      "採用募集",
      "ルール",
      "個人",
    ])
  ) {
    labels.push("ルール違反候補");
  }
  if (
    includesAny(text, [
      "まとめました",
      "メモです",
      "回避策",
      "手順",
      "テンプレ",
      "スプレッドシート",
      "サンプル",
      "作例",
      "過去ログ",
    ])
  ) {
    labels.push("高価値UGC");
  }
  if (
    includesAny(text, [
      "はじめて",
      "初めて",
      "初心者",
      "どちらに",
      "どのチャンネル",
      "ロール",
      "招待リンク",
      "どこで確認",
      "見つけられません",
    ])
  ) {
    labels.push("新規参加者の困りごと");
  }
  if (includesAny(text, ["前回も", "ベータの頃", "昔", "長めに", "続けにくい"])) {
    labels.push("古参の重要指摘");
  }

  return labels.length === 0 ? ["雑談"] : uniqueLabels(labels);
}

function importanceForLabels(message: Message, labels: readonly ClassificationLabel[]): Importance {
  const text = message.content;
  if (
    labels.includes("炎上兆候") ||
    (labels.includes("ルール違反候補") &&
      includesAny(text, ["APIキー", "トークン", "メールアドレス"])) ||
    includesAny(text, ["全リクエスト", "SSO", "同じ課金エラー", "同じ障害"])
  ) {
    return "critical";
  }
  if (
    labels.includes("公式回答待ち") ||
    labels.includes("古参の重要指摘") ||
    (labels.includes("バグ報告") &&
      includesAny(text, ["再現", "ログイン", "課金", "本番", "招待", "Safari"]))
  ) {
    return "high";
  }
  if (
    labels.some((label) =>
      ["質問", "バグ報告", "要望", "不満", "高価値UGC", "新規参加者の困りごと"].includes(label),
    )
  ) {
    return "medium";
  }
  return "low";
}

function actionTypeForLabels(
  labels: readonly ClassificationLabel[],
  importance: Importance,
): AdminActionType {
  if (labels.includes("ルール違反候補")) {
    return "privacy_or_rule_check";
  }
  if (labels.includes("バグ報告") && importance !== "low") {
    return "bug_triage";
  }
  if (labels.includes("公式回答待ち")) {
    return "reply_check";
  }
  if (labels.includes("高価値UGC") || labels.includes("新規参加者の困りごと")) {
    return "faq_candidate";
  }
  if (importance === "medium") {
    return "weekly_report";
  }
  return "none";
}

export function classifyMessage(message: Message): Classification {
  const labels = labelsForMessage(message);
  const importance = importanceForLabels(message, labels);
  const adminActionNeeded = importance === "high" || importance === "critical";
  const adminActionType = actionTypeForLabels(labels, importance);
  const summary =
    message.content.length > 64 ? `${message.content.slice(0, 64)}...` : message.content;
  const draft: DraftClassification = {
    labels,
    importance,
    adminActionNeeded,
    adminActionType,
    confidence: importance === "low" ? 0.78 : 0.86,
    reason: `${labels.join("、")}に該当する投稿内容のため。`,
    suggestedSummary: summary,
  };

  return buildClassification(
    {
      labels: draft.labels,
      importance: draft.importance,
      admin_action_needed: draft.adminActionNeeded,
      admin_action_type: draft.adminActionType,
      confidence: draft.confidence,
      reason: draft.reason,
      suggested_summary: draft.suggestedSummary,
    },
    {
      id: newId(),
      messageId: message.id,
      modelName: "rule-based-dogfood-v0",
      createdAt: nowIso(),
    },
  );
}
