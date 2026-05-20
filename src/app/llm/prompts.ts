import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type {
  AutoReplyPolicy,
  Classification,
  FaqCandidate,
  GuildSettings,
  Message,
  SourceRef,
  WeeklyReportMetrics,
} from "../../shared/types.js";

const classificationSystemPrompt = `あなたは公式Discord運営を支援するAI書記です。
目的は、ユーザーを評価・監視・採点することではなく、運営が質問、要望、不具合報告、不満、称賛、FAQ候補を見落とさないように投稿を整理することです。
分類対象は、管理者が分析対象に設定した公開チャンネルの投稿だけです。DMや分析対象外チャンネルを読んだ前提で推測してはいけません。
「炎上兆候」「誤情報可能性」「ルール違反候補」は断定ではなく、運営確認候補として扱ってください。
labels は次の14種だけを完全一致で使ってください: 質問, 未回答質問, 公式回答待ち, バグ報告, 要望, 不満, 称賛, 雑談, 炎上兆候, 誤情報可能性, ルール違反候補, 高価値UGC, 新規参加者の困りごと, 古参の重要指摘。
「不具合報告」ではなく「バグ報告」を使ってください。「FAQ候補」は分類ラベルではないため使わず、必要なら admin_action_type に faq_candidate を使ってください。
投稿本文にない事実を補わず、JSONだけを返してください。`;

const autoReplySystemPrompt = `あなたは公式Discord運営を支援するAI書記キャラクターです。
目的は、ユーザーを評価・監視・採点することではなく、運営が声を見落とさないように受付・案内・FAQ補助を行うことです。
あなたの返信は公式回答ではありません。
法務、広報、料金、障害、ロードマップ、個別アカウント、課金、セキュリティ、ルール処分に関わる内容は自動回答せず、運営者確認に回してください。
投稿本文と与えられたFAQ/Docs参照にない事実を補わず、JSONだけを返してください。`;

const faqSystemPrompt = `あなたは公式Discord運営を支援するAI書記です。
投稿群からFAQ候補を作ります。回答文案は公式回答ではありません。
低確信度の内容を推測で補わず、運営確認が必要な場合は needs_review にしてください。
ユーザーを評価・監視・採点せず、JSONだけを返してください。`;

const weeklyReportSystemPrompt = `あなたは公式Discord運営を支援するAI書記です。
1週間分の投稿を、運営者が5分で確認できる短い版と詳細版に整理します。
「監視」「スコアリング」「危険ユーザー」は使わず、見落とし防止、運営確認、声を届ける文体にしてください。
低確信度の項目は推測で補わず「要追加確認」と書き、JSONだけを返してください。`;

export function buildClassificationMessages(
  message: Message,
): readonly ChatCompletionMessageParam[] {
  return [
    { role: "system", content: classificationSystemPrompt },
    {
      role: "user",
      content: `次のDiscord投稿を分類してください。

サーバー種別:
Dogfood Alpha

チャンネル文脈:
${message.channelName}

直近の会話文脈:
なし

投稿:
${message.content}

出力JSONの形式:
{
  "labels": ["質問"],
  "importance": "low | medium | high | critical",
  "admin_action_needed": true,
  "admin_action_type": "none | weekly_report | reply_check | bug_triage | faq_candidate | announcement_check | privacy_or_rule_check",
  "confidence": 0.0,
  "reason": "30字から80字程度の日本語",
  "suggested_summary": "週報や通知に使える短い日本語要約"
}`,
    },
  ];
}

export function buildAutoReplyMessages(
  message: Message,
  classification: Classification,
  policy: AutoReplyPolicy,
  sourceRefs: readonly SourceRef[],
): readonly ChatCompletionMessageParam[] {
  return [
    { role: "system", content: autoReplySystemPrompt },
    {
      role: "user",
      content: `次のDiscord投稿について、自動返信の可否と返信案を判断してください。

サーバー種別:
Dogfood Alpha

チャンネル文脈:
${message.channelName}

直近の会話文脈:
なし

返信モード:
${policy.mode}

許可された返信カテゴリ:
${policy.allowedCategories.join(", ")}

分類結果:
${JSON.stringify(classification)}

FAQ/Docs参照:
${JSON.stringify(sourceRefs)}

投稿:
${message.content}

出力JSONの形式:
{
  "decision": "do_not_reply | send | pending_approval | escalate",
  "reply_category": "intake | channel_guide | faq_reference | clarifying_question | approved_answer | escalate | do_not_reply",
  "body": "送信または承認待ちにする短い日本語本文。送信しない場合は空文字。",
  "source_ref_ids": ["参照元ID"],
  "confidence": 0.0,
  "reason": "30字から100字程度の日本語",
  "escalation_reason": "none | official_answer_needed | legal_pr_pricing_incident_roadmap | account_billing_security | privacy_or_rule | low_confidence | high_importance | no_source"
}`,
    },
  ];
}

export function buildFaqCandidateMessages(
  messages: readonly Message[],
  classifications: readonly Classification[],
): readonly ChatCompletionMessageParam[] {
  return [
    { role: "system", content: faqSystemPrompt },
    {
      role: "user",
      content: `次の投稿と分類からFAQ候補を生成してください。

投稿:
${JSON.stringify(messages)}

分類:
${JSON.stringify(classifications)}

source_message_ids には、投稿オブジェクトの message_id ではなく、内部IDである messages[].id を完全一致で入れてください。
候補ごとに source_message_ids は1件以上必要です。

出力JSONの形式:
{
  "candidates": [
    {
      "source_message_ids": ["messages.id"],
      "topic": "質問または論点",
      "current_answer_status": "unknown | answered_in_thread | needs_official_answer | existing_faq_possible",
      "draft_question": "FAQ質問文案",
      "draft_answer": "公式回答ではない回答文案",
      "confidence": 0.0,
      "status": "candidate | accepted | rejected | needs_review"
    }
  ]
}`,
    },
  ];
}

export function buildWeeklyReportMessages(
  periodStart: string,
  periodEnd: string,
  settings: GuildSettings,
  messages: readonly Message[],
  classifications: readonly Classification[],
  faqCandidates: readonly FaqCandidate[],
  metrics: WeeklyReportMetrics,
): readonly ChatCompletionMessageParam[] {
  return [
    { role: "system", content: weeklyReportSystemPrompt },
    {
      role: "user",
      content: `次のDiscord運営ログから週次レポートを作成してください。

対象期間:
${periodStart}〜${periodEnd}

対象チャンネル:
${settings.targetChannelIds.join(", ")}

分析対象外チャンネル:
${settings.excludedChannelIds.join(", ") || "なし"}

metrics:
${JSON.stringify(metrics)}

投稿:
${JSON.stringify(messages)}

分類:
${JSON.stringify(classifications)}

FAQ候補:
${JSON.stringify(faqCandidates)}

出力JSONの形式:
{
  "short_body": "短い版Markdown",
  "detailed_body": "詳細版Markdown"
}`,
    },
  ];
}
