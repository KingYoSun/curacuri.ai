# Phase 1 残タスク

## 目的

このドキュメントは、Phase 1 Dogfood Alpha の実装済み範囲と仕様を突き合わせた残タスクを記録する。

Phase 1 の中核経路は、OpenAI Compatible LLM、PostgreSQL、BullMQ、Discord dry-run、Dashboard、Docker
Compose まで接続済みである。ここに残す項目は、Dogfood
Alpha を完了判定できる状態へ近づけるための未完了作業である。

## 最近完了した項目

### Dashboard の Shneiderman 8原則ベース改善（完了）

2026-05-21 に `DESIGN.md` を追加し、Dashboard UI の判断基準をBen
Shneiderman 氏のインターフェイスデザインの8つの黄金律に揃えた。

2026-05-21 の `feat: improve dashboard ux with shadcn` で、以下を実装済み。

- shadcn/ui と Tailwind CSS を既存Vite Dashboardへ導入。
- 操作中、成功、失敗のフィードバックを追加。
- LLM一括再実行、自動返信の承認/却下、通知dismiss、FAQ採用/却下に確認ダイアログを追加。
- 設定と自動返信ポリシーの編集中draftが、別操作後のrefreshで黙って上書きされないようにした。
- 週次レポート生成UIに期間入力を追加し、UI上の固定日付生成を解消。
- 投稿一覧の期間、チャンネル、ラベルfilter UIを追加。
- 分類結果一覧を追加。
- feedback種別選択UIを追加。
- 通知を `dismissed` にする操作とAPIを追加。
- FAQ候補の編集UIとAPIを追加。
- 週報一覧と詳細表示を改善。

残っているDashboard関連作業は、UI部品そのものではなく、バックエンド処理の対象絞り込み、BullMQ failed
jobの可視化、E2Eに近い確認に移っている。

## P0.5: Phase 1 完了判定に必要

### Discord 実接続の手動検証（完了）

2026-05-21 に `docs/discord-mcp-verification.md`
に従い、SaseQ/discord-mcp を検証者役botとして実施した。

- 対象チャンネル投稿が `discord.ingest` に入ることを確認済み。
- 除外チャンネルとDMが取り込まれないことを確認済み。
- `DISCORD_DRY_RUN=false` で管理者通知が実Discordへ投稿されることを確認済み。
- `intake_only`、`faq_assist`、`approval_required` の実投稿を確認済み。
- 高重要度、公式回答待ち、誤情報可能性、ルール違反候補が自動返信されないことを確認済み。
- 関係のない雑談がユーザー返信とadmin-ops通知を増やさないことを確認済み。

### `auto_reply_escalation_rules` の実装（完了）

2026-05-21 に実装済み。

- `auto_reply_escalation_rules` テーブルを正として、設定された有効ルールを自動返信判定に反映する。
- 固定の安全ゲートは維持しつつ、`label`、`category`、`keyword`、`importance`、`confidence`、`official_needed`、`privacy_or_rule`
  を追加ルールとして評価する。
- `notify_admin` は自動返信を運営確認へ回し、管理者通知を作成する。
- `draft_for_approval` は返信案を承認待ちにする。
- `do_not_reply` は本文なしでブロックする。
- Dashboard の自動返信ポリシーから、構造化フォームでルールを追加・編集・削除できる。

### LLM生成関数の `Phase1State` 依存解消

- `generateClassificationWithLlm` の `Phase1State` 依存を外す。
- `generateAutoReplyWithLlm` の `Phase1State` 依存を外す。
- `generateFaqCandidatesWithLlm` の `Phase1State` 依存を外す。
- `generateWeeklyReportWithLlm` の `Phase1State` 依存を外す。
- `llm/runs.ts` を state map 更新ではなく、run object を生成・更新する helper にする。
- 保存責務は `persistent-workflow` と repository 側へ集約する。
- 現状の repository から `Phase1State`
  を組み立てて保存し直す adapter 方式は、内部改善対象として残す。

### deleted / retention 対象データの除外を完全化

- `messages.deleted_at`
  は概ね除外されるが、週報metricsやclassification集計が削除済みmessageに紐づくclassificationを拾う余地がある。
- `retention_days` 処理は分類job後に走るだけで、定期jobまたは明示jobとしては未整備。
- 分類、FAQ候補、週報、metrics の全経路で削除済み投稿を除外する。

### 管理者通知の重複送信対策

- `ops.notify` の再実行や複数worker起動時に、同じ管理者通知が実Discordへ重複投稿されないようにする。
- 送信前に `admin_notifications.status` と `sent_message_id` をDB側で原子的に確認・更新する。
- Discord実接続検証では、同一分類・同一通知に対するadmin-ops投稿が1回だけになることを確認する。

### 雑談への過剰反応と過剰ログ生成の抑制

- `雑談`、`low`、`admin_action_needed=false` の投稿では、原則として `auto_reply.decide` と
  `auto_replies` record を作らない。
- 自動返信の許可ラベル外であることを理由にした `escalated`
  record が、Dashboardの自動返信ログを埋めないようにする。
- Discord実接続検証では、関係のない雑談がユーザー返信、admin-ops通知、自動返信ログのいずれも増やさないことを確認する。

## P1: 運用品質

### Dashboard/API の残課題

- `POST /api/reports/weekly` のbody未指定時fallbackが、まだ `2026-01-01` から `2026-01-07`
  である。UIは直近完了週を送るが、API単体でも安全な既定値にする。
- Dashboard の主要操作は `pnpm check`
  で型とAPI単体テストを通しているが、ブラウザ操作レベルの自動テストは未整備。
- shadcn/ui 導入後の画面を、実データ投入状態で目視確認し、表示密度、折り返し、モバイル幅の細部を調整する。
- FAQ候補と自動返信ログの操作ボタンが、現在のstatusに応じて十分に制御されていない。
  - 自動返信は、送信済みなど承認/却下の対象ではない状態でも「承認」「却下」が表示され得る。
  - FAQ候補は、現在のstatusと同じ状態変更ボタンを繰り返し押せる。
  - statusごとに許可する操作を定義し、無効化、非表示、補助文言のいずれかで誤操作を防ぐ。

### FAQ / report queue payload の実利用

- `faq.generate` の `messageIds`、`periodStart`、`periodEnd` を処理に反映する。
- `report.weekly.channelIds` を週報対象の絞り込みに反映する。
- 現状は settings と全体snapshotへの依存が強い。

### 手動ナレッジ拡充

- 運営者が公式FAQ、Docs、チャンネル案内、定型回答を手動登録できる導線を追加する。
- `faq_assist`
  が、過去投稿から生成されたFAQ候補だけでなく、承認済みの手動ナレッジも参照できるようにする。
- 手動ナレッジは、FAQ候補の編集UIとは別の公式情報ソースとして扱う。

### 通知集約

- 複数人から出ている不具合報告を集約する。
- 急増している不満を集約する。
- 昨日以前の未回答質問を検出する。
- 現状は単一投稿ベースの通知生成が中心。

### LLM出力品質調整

- FAQ候補の粒度を調整する。
- 週報短い版が5分で確認できる長さになっているか確認し、必要ならプロンプトを調整する。
- 自動返信本文の安全さと自然さをレビューする。

### Queue payload validation

- 仕様では shared schema validation 前提だが、現状は TypeScript 型中心。
- runtime validation を追加し、不正payloadを明示的に失敗扱いにする。

### BullMQ failed job の可視化

- LLM失敗runはDashboard/APIで確認できる。
- BullMQ job自体の失敗一覧と再実行導線は未整備。
- worker失敗を運用者が把握できる表示またはAPIを追加する。

## P2: テスト拡充

### Postgres repository tests

- message upsert の冪等性を検証する。
- deleted message が分類、FAQ、週報対象から外れることを検証する。
- settings / policy 更新がDBへ保存されることを検証する。
- LLM run retry がDB状態から再実行できることを検証する。

### Queue integration tests

- sample import から `message.classify` が作られることを検証する。
- classify job から notification と `auto_reply.decide` が作られることを検証する。
- faq / report queue で候補と週報が生成されることを検証する。
- failed job 時に対象レコードが失敗状態になることを検証する。

### Discord dry-run tests

- pending notification が dry-run sent になることを検証する。
- auto reply send が `dry-run:<id>` を保存することを検証する。
- `disabled` では送信queueが作られないことを検証する。
- high / critical / official-needed は送信されないことを検証する。

### Dashboard / API tests

- settings / policy update は検証済み。
- notification dismiss、FAQ候補編集、FAQ status update、FAQ feedbackのstatus維持は検証済み。
- auto reply approve / reject を検証する。
- feedback 保存を検証する。
- message filter query を検証する。
- Dashboard のブラウザ操作テストは未整備。E2E基盤を入れる場合は別タスクとして扱う。

## Phase 1 スコープ外として残すもの

- Hosted / OAuth / 複数guild / マルチテナント。
- 外部協力者Discord導入。
- Slack、Notion、GitHub連携。
- 公式回答の完全自動投稿。
- 自動モデレーション、BAN、ロール操作。
- ユーザーごとのスコアや危険度。

## 補足

Phase 1 の残タスクとして漏れていた大きな項目は、LLM生成関数の分解、deleted /
retention 除外の完全化、FAQ / report
payload の実利用である。これらは表面機能だけを見ると見落としやすいが、Dogfood
Alpha を継続運用するための内部品質として扱う。
