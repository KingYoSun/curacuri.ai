# 週次運営レポートテンプレート v0

## 目的

日本語Discord運営ログの1週間分の投稿を、運営者が5分で把握できる形に整理する。Dogfood
Alphaでは自前運用、サンプルログ、疑似ログ、Closed
Betaでは協力者Discordにも使えるテンプレートとして扱う。本文では「監視」「スコアリング」「危険ユーザー」などの表現を使わず、「声を届ける」「見落とし防止」「運営確認」の文体に揃える。

## 短い版

```text
# 今週のDiscord運営メモ

対象期間: {{start_date}}〜{{end_date}}
対象チャンネル: {{channels}}
集計対象投稿数: {{message_count}}

## まず確認したいこと

- {{action_1}}
- {{action_2}}
- {{action_3}}

## 今週の主要トピック

1. {{topic_1}}
2. {{topic_2}}
3. {{topic_3}}

## 見落とし防止メモ

- 未回答質問: {{unanswered_question_count}}件
- バグ報告候補: {{bug_report_count}}件
- 要望: {{feature_request_count}}件
- 不満・戸惑い: {{complaint_count}}件
- FAQ候補: {{faq_candidate_count}}件

## 運営確認が必要そうな声

- {{admin_check_item_1}}
- {{admin_check_item_2}}
- {{admin_check_item_3}}

## コミュニティ温度感

{{community_mood_summary}}
```

## 詳細版

```text
# 週次運営レポート

対象期間: {{start_date}}〜{{end_date}}
対象チャンネル: {{channels}}
分析対象外チャンネル: {{excluded_channels}}
集計対象投稿数: {{message_count}}

## 1. 要約

{{executive_summary}}

## 2. 今週の主要トピック

| トピック | 概要 | 関連チャンネル | 運営確認 |
| --- | --- | --- | --- |
| {{topic}} | {{summary}} | {{channel}} | {{admin_check}} |

## 3. 未回答質問

| 質問 | チャンネル | 経過 | 公式回答の必要性 | 推奨対応 |
| --- | --- | --- | --- | --- |
| {{question}} | {{channel}} | {{age}} | {{official_needed}} | {{recommended_action}} |

## 4. 要望

| 要望 | 背景 | 件数 | 優先度メモ |
| --- | --- | --- | --- |
| {{request}} | {{context}} | {{count}} | {{priority_note}} |

## 5. 不満・戸惑い

| 内容 | 温度感 | 影響範囲 | 推奨対応 |
| --- | --- | --- | --- |
| {{complaint}} | {{mood}} | {{impact}} | {{recommended_action}} |

## 6. バグ報告候補

| 症状 | 再現情報 | 報告数 | Issue化メモ |
| --- | --- | --- | --- |
| {{symptom}} | {{reproduction}} | {{count}} | {{issue_note}} |

## 7. 称賛・ポジティブ反応

- {{positive_1}}
- {{positive_2}}
- {{positive_3}}

## 8. FAQ候補

| 質問・論点 | 現在の回答状況 | FAQ文案 |
| --- | --- | --- |
| {{faq_topic}} | {{current_answer_status}} | {{faq_draft}} |

## 9. 運営確認が必要な話題

| 種別 | 内容 | 理由 | 推奨アクション |
| --- | --- | --- | --- |
| {{type}} | {{content}} | {{reason}} | {{action}} |

## 10. 前週との差分

{{week_over_week_diff}}

## 11. 次の推奨アクション

1. {{next_action_1}}
2. {{next_action_2}}
3. {{next_action_3}}
```

## 生成ルール

- 最初に3件以内の「まず確認したいこと」を置く。
- 投稿者個人の評価ではなく、話題・投稿・確認事項として書く。
- 炎上兆候や誤情報可能性は断定せず、「運営確認が必要そう」と表現する。
- 低確信度の項目は、推測ではなく「要追加確認」と書く。
- 同じ質問が繰り返されている場合は、FAQ候補にまとめる。
- バグ報告候補は、再現情報の有無と報告数を分けて書く。
- 称賛はプロダクト改善や広報に使える粒度で残す。
- 管理者が5分で読めるよう、短い版はA4 1枚相当に収める。

## 導入告知テンプレートとの整合

レポートの説明では、次の言い方を使う。

- 運営が声を見落とさないための整理。
- 指定された公開チャンネルの投稿だけを対象にする。
- DMは読まない。
- ユーザー評価や自動処分はしない。
- 公式回答は人間の運営者が判断する。
