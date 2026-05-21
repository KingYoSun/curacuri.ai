# Phase 1 残タスク

## 目的

このドキュメントは、Phase 1 Dogfood Alpha の実装済み範囲と仕様を突き合わせた残タスクを記録する。

Phase 1 の中核経路は、OpenAI Compatible LLM、PostgreSQL、BullMQ、Discord dry-run、Dashboard、Docker
Compose まで接続済みである。ここに残す項目は、Dogfood
Alpha を完了判定できる状態へ近づけるための未完了作業である。

## P0.5: Phase 1 完了判定に必要

### Discord 実接続の手動検証

繰り返し検証は `docs/discord-mcp-verification.md`
に従い、SaseQ/discord-mcp を検証者役botとして使える状態で実施する。

- 対象チャンネル投稿が `discord.ingest` に入ることを確認する。
- 除外チャンネルとDMが取り込まれないことを確認する。
- `DISCORD_DRY_RUN=false` で管理者通知が実Discordへ投稿されることを確認する。
- `intake_only`、`faq_assist`、`approval_required` の実投稿を確認する。
- 高重要度、公式回答待ち、誤情報可能性、ルール違反候補が自動返信されないことを確認する。

### `auto_reply_escalation_rules` の実装

- DB schema と型はあるが、実ロジックとDashboard更新対象としては未実装。
- 現状は固定の安全ゲートだけで判定している。
- Phase 1 では、設定されたルールが自動返信判定に反映される状態まで実装する。

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

## P1: 運用品質

### Dashboard の不足UI

- 投稿一覧の期間、チャンネル、ラベル filter UI を追加する。
- 分類結果一覧を表示する。
- feedback 種別選択 UI を追加する。
- 通知を `dismissed` にする操作を追加する。
- FAQ候補の編集UIを追加する。
- 週報一覧と詳細表示の読みやすさを改善する。

### FAQ / report queue payload の実利用

- `faq.generate` の `messageIds`、`periodStart`、`periodEnd` を処理に反映する。
- `report.weekly.channelIds` を週報対象の絞り込みに反映する。
- 現状は settings と全体snapshotへの依存が強い。

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
- BullMQ job自体の失敗一覧と再実行導線は限定的。
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

- settings / policy update を検証する。
- FAQ status update を検証する。
- auto reply approve / reject を検証する。
- feedback 保存を検証する。
- message filter query を検証する。

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
