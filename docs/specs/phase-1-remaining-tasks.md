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

### 管理者通知の重複送信対策（完了）

2026-05-21 に実装済み。

- `ops.notify` の複数worker実行時でも、送信前に `admin_notifications`
  をDB上でclaimし、claimできたworkerだけがDiscordへ投稿する。
- claimは既存の `sent_message_id` に `sending:<uuid>`
  を一時保存する方式とし、新しいqueue、DBカラム、通知statusは追加していない。
- 送信成功時は実Discord message IDへ置き換え、送信失敗時はclaim tokenを消して `failed`
  として保存する。
- 古いsnapshot保存で `sent`、`dismissed`、`failed`、claim済み `pending` が巻き戻らないようにした。
- Dashboardでは内部claim tokenを表示せず、「送信処理中」と表示する。

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

### LLM生成関数の `Phase1State` 依存解消（完了）

2026-05-21 に実装済み。

- `generateClassificationWithLlm` の `Phase1State` 依存を外す。
- `generateAutoReplyWithLlm` の `Phase1State` 依存を外す。
- `generateFaqCandidatesWithLlm` の `Phase1State` 依存を外す。
- `generateWeeklyReportWithLlm` の `Phase1State` 依存を外す。
- `llm/runs.ts` を state map 更新ではなく、run object を生成・更新する helper にする。
- 保存責務は `persistent-workflow` と repository 側へ集約する。
- 現状の repository から `Phase1State`
  を組み立てて保存し直す adapter 方式は、内部改善対象として残す。

### deleted / retention 対象データの除外を完全化（完了）

2026-05-21 に実装済み。

- `active-data` helper を追加し、active message に紐づく classification、FAQ候補、auto
  replyだけを生成入力とmetricsに使う。
- `message.classify`、`auto_reply.decide`、`faq.generate`、`report.weekly` の処理開始前に
  `retention_days` による論理削除を実行する。
- `messages.deleted_at IS NOT NULL` の投稿は、分類、FAQ候補、週報、metricsの全経路から除外する。
- `/api/messages`、`/api/faq-candidates`、`/api/reports/weekly` 生成受付でも retention
  sweep を実行する。
- 専用queue、API、DB schema、ADRは追加しない。

### 雑談への過剰反応と過剰ログ生成の抑制（完了）

2026-05-21 に実装済み。

- `雑談`、`low`、`admin_action_needed=false` の投稿では、`auto_reply.decide` と `auto_replies`
  record を作らない。
- 自動返信の許可ラベル外で、管理者対応不要、高重要度ではなく、固定エスカレーションラベルでもない投稿は、
  `escalated` record を作らない。
- `auto_reply.decide` handler 側にも同じguardを置き、既存・手動・retry由来のstale
  jobでも自動返信ログを増やさない。
- `公式回答待ち`、`炎上兆候`、`誤情報可能性`、`ルール違反候補`、高重要度、管理者対応が必要な投稿は、従来どおり通知または自動返信安全ゲートの対象として残す。

## P1: 運用品質

### Dashboard/API の残課題（完了）

2026-05-21 に実装済み。

- `POST /api/reports/weekly` のbody未指定時fallbackを、固定の `2026-01-01` から `2026-01-07`
  ではなく、月曜始まり・日曜終わりの直近完了週にした。
- LLM一括再実行や週報run retry由来の `report.weekly` 再投入も、同じ直近完了週fallbackを使う。
- Dashboard の週報生成フォーム初期値も、同じhelperで直近完了週を表示する。
- 自動返信ログの承認/却下ボタンは `pending_approval`
  のみ表示し、それ以外のstatusでは承認対象外であることを補助表示する。
- 自動返信承認/却下APIは `pending_approval` 以外を `409 Conflict`
  とし、送信済みなどを再操作して状態変更やqueue投入が起きないようにした。
- FAQ候補の状態変更ボタンは、現在のstatusと同じボタンを表示しない。
- 既存のVitest/API単体テストで、週報fallback、LLM再投入fallback、自動返信承認/却下guard、Dashboard操作ルールを検証する。

ブラウザ操作レベルの自動テストは、Playwright等のE2E基盤追加を伴うため、P2の別タスクとして扱う。shadcn/ui 導入後の実データ投入状態での表示密度、折り返し、モバイル幅の目視確認も継続タスクとして残す。

### FAQ / report queue payload の実利用（完了）

2026-05-21 に実装済み。

- `faq.generate` の `messageIds`、`periodStart`、`periodEnd` をLLM入力に反映する。
- 絞り込み付きFAQ生成では、対象投稿に紐づく既存FAQ候補だけを差し替え、範囲外の候補は残す。
- `report.weekly` は `channelIds`、`periodStart`、`periodEnd`
  で投稿、分類、FAQ候補、自動返信、metricsを同じ対象集合に絞る。
- 週報プロンプトと保存される `targetChannelIds` は `report.weekly.channelIds` を反映する。
- `/api/faq-candidates/generate` から任意の `messageIds` をqueue payloadへ渡せるようにした。

### 手動ナレッジ拡充（完了）

2026-05-22 に実装済み。

- 運営者が公式FAQ、Docs、チャンネル案内、定型回答を公式ナレッジとして手動登録、編集、公開、アーカイブできるDashboard/APIを追加した。
- `faq_assist`
  が、承認済みFAQ候補に加えて、公開済み公式ナレッジをpgvector検索で参照できるようにした。
- 手動ナレッジはFAQ候補の編集UIとは別タブ、別API、別DBテーブルの公式情報ソースとして扱う。
- Embeddings APIの失敗は保存失敗にせず、`embedding_error` として運用者が確認できるようにした。

### 通知集約（完了）

2026-05-25 に実装済み。

- 複数人から出ている不具合報告を集約する。
- 急増している不満を集約する。
- 昨日以前の未回答質問を検出する。
- 既存の `admin_notifications` を使い、DB schema や queue 名を追加せずに集約通知を作る。
- 集約通知は pending/failed の既存集約通知を更新し、sent/dismissed 済み通知は巻き戻さない。

### LLM出力品質調整（完了）

2026-05-25 に実装済み。

- FAQ候補の粒度を調整する。
- 週報短い版が5分で確認できる長さになっているか確認し、必要ならプロンプトを調整する。
- 自動返信本文の安全さと自然さをレビューする。
- FAQ候補は近い論点を1候補へまとめ、根拠の薄い推測や一時的な雑談を候補化しないようにした。
- 週報短い版は最大5項目、各項目1〜2文へ制限するプロンプトにした。
- 自動返信は1〜3文、断定・約束・未確認手順追加を避ける安全制約を追加した。

### Queue payload validation（完了）

2026-05-25 に実装済み。

- 仕様では shared schema validation 前提だが、現状は TypeScript 型中心。
- runtime validation を追加し、不正payloadを明示的に失敗扱いにする。
- `validateQueuePayload` を追加し、queue publish 時と worker 実行時に payload を検証する。
- `report.weekly` の日付、ID配列、必須フィールドなどを runtime で検証する。

### BullMQ failed job の可視化（完了）

2026-05-25 に実装済み。

- LLM失敗runはDashboard/APIで確認できる。
- BullMQ job自体の失敗一覧と再実行導線は未整備。
- worker失敗を運用者が把握できる表示またはAPIを追加する。
- `GET /api/queues/failed` と `POST /api/queues/:queueName/jobs/:id/retry` を追加した。
- Dashboard に Queue失敗カードを追加し、failed job の理由、試行回数、再実行導線を表示する。

## P2: テスト拡充

### Postgres repository tests（完了）

2026-05-25 に実装済み。

- message upsert の冪等性を検証する。
- deleted message が分類、FAQ、週報対象から外れることを検証する。
- settings / policy 更新がDBへ保存されることを検証する。
- LLM run retry がDB状態から再実行できることを検証する。
- `TEST_DATABASE_URL` 指定時に実Postgresで走る repository integration test を追加した。

### Queue integration tests（完了）

2026-05-25 に実装済み。

- sample import から `message.classify` が作られることを検証する。
- classify job から notification と `auto_reply.decide` が作られることを検証する。
- faq / report queue で候補と週報が生成されることを検証する。
- failed job 時に対象レコードが失敗状態になることを検証する。
- persistent workflow の queue handler 単位で、ingest、classify、FAQ、週報、失敗run記録を検証する。

### Discord dry-run tests（完了）

2026-05-25 に実装済み。

- pending notification が dry-run sent になることを検証する。
- auto reply send が `dry-run:<id>` を保存することを検証する。
- `disabled` では送信queueが作られないことを検証する。
- high / critical / official-needed は送信されないことを検証する。
- Discord sender と自動返信安全境界の dry-run 単体テストを追加した。

### Dashboard / API tests（完了）

2026-05-25 に実装済み。

- settings / policy update は検証済み。
- notification dismiss、FAQ候補編集、FAQ status update、FAQ feedbackのstatus維持は検証済み。
- auto reply approve / reject を検証する。
- feedback 保存を検証する。
- message filter query を検証する。
- BullMQ failed job API、auto reply approve/reject、feedback保存、message filter query を検証する。
- Dashboard のブラウザ操作テストは、E2E基盤を追加しない方針のため Phase 1 完了条件からは外す。

## 2026-05-25 品質確認

- `pnpm check` 実行済み。
- `TEST_DATABASE_URL=postgres://curacuri:curacuri@localhost:5432/curacuri pnpm test -- tests/phase1/postgres-repository.test.ts`
  実行済み。
- `docs/discord-mcp-verification.md` に従い、SaseQ/discord-mcp を検証者役botとして実接続確認済み。
- 対象チャンネル投稿が `discord.ingest` 経由でDBへ入ることを確認済み。
- 除外チャンネル投稿がDBへ入らないことを確認済み。
- curacuri.ai bot へのDMは Discord API が `50007` で送信拒否したため、DBへ入らないことのみ確認済み。
- `DISCORD_DRY_RUN=false` で管理者通知が実Discordの管理者通知チャンネルへ投稿されることを確認済み。
- `intake_only`、`faq_assist`、`approval_required` の実投稿を確認済み。
- 高重要度、公式回答待ち、誤情報可能性の投稿が自動送信されず、運営確認に回ることを確認済み。
- 関係のない雑談が自動返信と管理者通知を増やさないことを確認済み。
- BullMQ failed job API が 0 件を返すことを確認済み。

## 2026-05-25 仕様再点検で見つかった残タスク

`docs/specs/phase-1-dogfood-alpha.md`
と現実装を再確認した結果、分類、通知、FAQ候補、週報、自動返信、管理者フィードバック、Discord実接続の中核経路は Phase
1 完了条件を満たしている。

ただし、仕様文面に対して以下は未完了または検証不足として残す。

### 導入告知テンプレートの完全化

- 仕様では、管理画面またはドキュメントからユーザー向け導入告知テンプレートを参照できることになっている。
- Dashboard には `導入告知テンプレート`
  の短い説明があるが、仕様で求める以下の項目をそのまま使えるテンプレートとしては網羅していない。
- 読み取り対象チャンネル、分析対象外チャンネル、保存情報、保存期間、削除依頼手順、自動返信のON/OFF、返信する範囲、返信しない条件、公式回答との分離を含むテンプレートへ拡充する。
- `docs/research/discord-tos-privacy-check.md` のユーザー告知項目と整合させる。

### 週次レポートフィードバックの明示テスト

- `POST /api/reports/weekly/:id/feedback` と Dashboard の週次レポート feedback UI は実装済み。
- ただし、Phase 1 仕様の integration test 項目である「週次レポートに対する `admin_feedback`
  が保存される」を、専用テストとして明示できていない。
- `tests/phase1/api-dashboard-actions.test.ts`
  または repository/API テストに、週次レポート feedback 保存の回帰テストを追加する。

## Phase 1 スコープ外として残すもの

- Hosted / OAuth / 複数guild / マルチテナント。
- 外部協力者Discord導入。
- Slack、Notion、GitHub連携。
- 公式回答の完全自動投稿。
- 自動モデレーション、BAN、ロール操作。
- ユーザーごとのスコアや危険度。

## 補足

Phase 1 の残タスクとして漏れていた大きな項目は、LLM生成関数の分解、FAQ / report
payload の実利用である。これらは表面機能だけを見ると見落としやすいが、Dogfood
Alpha を継続運用するための内部品質として扱う。
