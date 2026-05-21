# Phase 1 Dogfood Alpha 実装ログ

Phase 1 の残タスクは `docs/specs/phase-1-remaining-tasks.md` に整理する。

## 2026-05-20

### 仕様外の追加判断

- LLM実接続前でもDogfood動線を検証できるよう、分類器は `rule-based-dogfood-v0`
  という決定的なローカル実装を先に追加した。将来のOpenAI API実装は同じ分類出力schemaに差し替える。
- PostgreSQL/Redis/Discord実接続がないローカルテストでも動くよう、APIの初期実装はインメモリストアを使う。DB
  migration と queue 契約は同時に追加し、永続化実装へ移行できる形にした。
- Dashboard はVite Reactで実装し、Phase
  1の主要状態を確認する Alpha 画面に限定した。細かい編集UIはAPI契約を先に固定し、後続で強化する。

### 範囲を広げなかったもの

- Hosted公開、OAuth導入ウィザード、マルチテナント、複数guild管理は追加していない。
- 公式回答の完全自動投稿、自動モデレーション、自動BAN、自動ロール操作は追加していない。
- ユーザーごとの評価、採点、危険度、信頼度は保存していない。

## 2026-05-20 OpenAI Compatible LLM実接続

### 仕様外の追加判断

- OpenAI Compatibleプロバイダの互換性を優先し、Responses APIではなく `/v1/chat/completions`
  互換のChat Completionsを使う。
- 環境変数は `OPENAI_*` ではなく `LLM_*` に統一した。
- JSON出力は `json_schema` ではなく `json_object` を既定にした。schema validationはアプリ側で行う。
- LLM未設定、通信失敗、JSON不正、schema validation失敗ではrule-based
  fallbackを使わず、`llm_generation_runs`
  に失敗として保存し、Dashboard/APIから再実行できるようにした。
- 実APIを叩くテストは `pnpm check` に含めず、fake LLM clientで決定的に検証する。
- LLM、Discord、ローカルサービスの環境変数は `.env` で管理し、git管理するのは `.env.example`
  のみにした。
- Google Gemini のOpenAI互換endpointではChat Completionsの `metadata`
  が400になるため、互換性優先でLLMリクエストに `metadata` を付けない。

### 範囲を広げなかったもの

- Responses API対応、provider別adapter、LLMコスト集計、永続DB repository実装は追加していない。
- APIキー、Authorization header、provider secretをDB、run raw output、ログへ保存しない。

## 2026-05-20 Phase 1 P0 永続化・queue・dry-run送信

### 仕様外の追加判断

- 既存のLLM生成関数が `Phase1State` に結合しているため、P0ではPostgreSQL
  repositoryから状態を読み出し、処理後にDBへ同期する薄い永続化workflowを追加した。LLM生成関数の全面分解は後続の内部改善とする。
- 自動返信LLMが即時送信可能と判断した場合でも、DB保存時には `drafted`
  として保存し、`auto_reply.send` queueでdry-runまたは実送信した時点で `sent`
  に更新する。送信事故を避けるため、送信状態の確定はsender adapterに集約した。
- `ops.notify`
  は個別通知IDではなくpending通知をまとめて処理する。分類jobが通知候補を保存した後にqueueへ投入するため、P0の運用では重複実行されてもDB状態で判定できる。
- Discord実送信はWebhookではなくBot tokenでDiscord REST
  APIへ投稿するadapterにした。`DISCORD_DRY_RUN=true` ではDiscord APIを呼ばず、`dry-run:<id>`
  を送信message idとして保存する。

### 範囲を広げなかったもの

- 既存DBの移行互換、複数guild分離、API認証、Hosted運用、OAuth導入は追加していない。
- BullMQ
  job履歴を独自DBテーブルへ複製していない。job受付状態はBullMQ、業務状態は各ドメインテーブルに保存する。
- Discord実送信の本番疎通確認はdry-run既定のため行わない。

## 2026-05-20 Discord実接続検証者MCP対応

### 仕様外の追加判断

- Phase
  1 のDiscord実接続検証をCodexから繰り返せるよう、SaseQ/discord-mcpを検証者役botとして使う手順を追加した。
- 通常のbot投稿除外は維持し、明示フラグ、許可bot ID、非本番 `CURACURI_ENV`、非production `NODE_ENV`
  が揃う場合だけ検証者役bot投稿を取り込めるようにした。

### 範囲を広げなかったもの

- 通常ユーザーアカウントの自動操作、Discord Web UIの自動操作、self-bot型実装は採用しない。
- Hosted公開や外部協力者Discord向けには、この検証者役bot許可を使わない。
