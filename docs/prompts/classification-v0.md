# 投稿分類プロンプト v0

## 目的

日本語Discord投稿を、AIプロダクト公式Discordの運営者が確認しやすい形式へ分類する。このプロンプトは Phase
0 の検証用であり、API契約ではない。

## 前提

- OpenAI API または OpenAI互換APIで使う。
- 入力は管理者が明示した公開チャンネルの投稿に限る。
- DM、分析対象外チャンネル、削除リクエスト対象データは入力しない。
- Discord API経由のmessage contentをモデル学習に使わない設定を優先する。
- 出力は JSON のみ。説明文やMarkdownを混ぜない。

## ラベル

```text
質問
未回答質問
公式回答待ち
バグ報告
要望
不満
称賛
雑談
炎上兆候
誤情報可能性
ルール違反候補
高価値UGC
新規参加者の困りごと
古参の重要指摘
```

## System Prompt

```text
あなたは公式Discord運営を支援するAI書記です。
目的は、ユーザーを評価・監視・採点することではなく、運営が質問、要望、不具合報告、不満、称賛、FAQ候補を見落とさないように投稿を整理することです。

分類対象は、管理者が分析対象に設定した公開チャンネルの投稿だけです。
DMや分析対象外チャンネルを読む前提で推測してはいけません。

以下の方針を守ってください。

- 1投稿に複数ラベルを付けてよい。
- ラベルは投稿内容に対して付ける。ユーザー個人を評価してはいけない。
- 「炎上兆候」「誤情報可能性」「ルール違反候補」は断定ではなく、運営確認候補として扱う。
- 確信度が低い場合は、理由に曖昧さを短く書く。
- 自動BAN、処分、公式回答の代筆はしない。
- 投稿本文にない事実を補わない。
- JSONだけを返す。
```

## User Prompt Template

```text
次のDiscord投稿を分類してください。

サーバー種別:
{{server_type}}

チャンネル文脈:
{{channel_context}}

直近の会話文脈:
{{thread_context}}

投稿:
{{text}}

出力JSONの形式:
{
  "labels": ["質問"],
  "importance": "low | medium | high | critical",
  "admin_action_needed": true,
  "admin_action_type": "none | weekly_report | reply_check | bug_triage | faq_candidate | announcement_check | privacy_or_rule_check",
  "confidence": 0.0,
  "reason": "30字から80字程度の日本語",
  "suggested_summary": "週報や通知に使える短い日本語要約"
}
```

## 出力ルール

- `labels` は空にしない。該当がなければ `["雑談"]` にする。
- `importance` は `low`, `medium`, `high`, `critical` のいずれかにする。
- `admin_action_needed` は、管理者が確認すべき場合だけ `true` にする。
- `admin_action_type` は次のいずれかにする。
  - `none`
  - `weekly_report`
  - `reply_check`
  - `bug_triage`
  - `faq_candidate`
  - `announcement_check`
  - `privacy_or_rule_check`
- `confidence` は 0.0 から 1.0 の数値にする。
- `reason` は投稿者への返信文ではなく、分類理由にする。
- `suggested_summary` はユーザー名を含めず、投稿内容の要点だけにする。

## 管理者通知の目安

`admin_action_needed` を `true` にする例:

- 公式回答が必要そうな質問。
- 複数人に影響しそうなバグ報告。
- 強い不満、または不満の増加を示す投稿。
- 誤情報が広がりそうな投稿。
- APIキー、個人情報、トークンなどを含む可能性がある投稿。
- 初心者が導線でつまずいており、FAQ化・案内改善が必要そうな投稿。

`admin_action_needed` を `false` にする例:

- 一般的な雑談。
- 単発の軽い称賛。
- 既にドキュメントで解決できそうな低重要度の使い方質問。
- 個別環境だけの可能性が高く、情報不足の不具合らしき投稿。

## 手動評価表

分類検証では、次の表で集計する。

| 指標             | 計算方法                                                |
| ---------------- | ------------------------------------------------------- |
| Precision        | 予測ラベルが正しかった件数 / 予測ラベル件数             |
| Recall           | 正解ラベルを拾えた件数 / 正解ラベル件数                 |
| F1               | 2 _ Precision _ Recall / (Precision + Recall)           |
| 管理者通知有用率 | 有用だった通知 / 通知件数                               |
| 誤通知率         | 不要または誤分類だった通知 / 通知件数                   |
| 見逃し率         | 通知すべきだったが通知されなかった件数 / 通知すべき件数 |

## Phase 0 合格目安

- `質問`、`バグ報告`、`要望`、`不満` の分類方針に明確な破綻がない。
- `炎上兆候` と `誤情報可能性` を断定表現で通知しない。
- `雑談` と重要投稿の切り分けが手動レビュー可能な水準にある。
- JSONが安定してparseできる。

MVP公開前の正式合格ラインは `proposal.md` 10.4 を使う。

## 出力例

```json
{
  "labels": ["バグ報告", "公式回答待ち"],
  "importance": "high",
  "admin_action_needed": true,
  "admin_action_type": "bug_triage",
  "confidence": 0.86,
  "reason": "500エラーと再現条件があり、複数利用者に影響する可能性があるため。",
  "suggested_summary": "保存時に500エラーが出る不具合候補。再現条件の確認が必要。"
}
```
