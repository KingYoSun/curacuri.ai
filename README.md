# curacuri.ai

curacuri.ai（クラクリAI）は、少数精鋭で公式 Discord を長期運営するチームのための、AI 書記・受付・運営補佐キャラクターです。

Discord サーバー内の質問、要望、不満、バグ報告、盛り上がりを整理し、週次レポート・重要通知・FAQ 候補・VOC 分析として運営者に届けることで、公式コミュニティ運営の認知負荷を下げることを目指します。

## 現在の状態

このリポジトリは、Codex 中心の開発ハーネスと Phase 1 Dogfood Alpha の縦断実装を含みます。

Phase 1 では、PostgreSQL永続化、BullMQ
queue、サンプルログ取り込み、投稿分類、重要通知候補、FAQ候補、限定自動返信判定、dry-run既定のDiscord送信、週次レポート、管理者フィードバック、Alpha管理画面の運用動線を実装しています。

## 技術方針

初期開発では以下を前提にします。

- TypeScript
- Node.js
- Hono
- Vite + React
- Redis
- BullMQ
- PostgreSQL + pgvector
- discord.js

詳細な技術判断は `docs/adr/` に記録します。

## セットアップ

```sh
pnpm install
cp .env.example .env
```

## 開発コマンド

```sh
pnpm check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm dev:api
pnpm dev:dashboard
pnpm dev:worker
pnpm dev:bot
```

`pnpm check`
は、型チェック、Lint、フォーマット確認、テストをまとめて実行するローカルの総合チェックです。

API は `http://localhost:8787`、Dashboard は `http://localhost:5173`
で起動します。Dashboard からサンプルログ投入と週次レポート生成を実行できます。

API、worker、bot の実運用経路では `DATABASE_URL` と `REDIS_URL`
が必須です。未設定の場合は起動に失敗します。

LLM実接続はOpenAI CompatibleなChat Completions APIを使います。実行には `.env`
を編集して次の環境変数を設定します。

```sh
LLM_API_KEY=...
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-5.5
LLM_TIMEOUT_MS=30000
LLM_CONCURRENCY=2
LLM_RESPONSE_FORMAT=json_object
```

`LLM_API_KEY` または `LLM_MODEL`
が未設定の場合、分類、返信案、FAQ候補、週次レポート生成は失敗runとして記録されます。Dashboard のLLM失敗一覧から個別再実行または一括再実行できます。

Discord 送信は `DISCORD_DRY_RUN=true` が既定です。この状態ではDiscord
APIを呼ばず、DB上だけで送信済みとして記録します。実送信する場合だけ `DISCORD_TOKEN` と
`DISCORD_DRY_RUN=false` を設定します。

Docker Compose で確認する場合は次を使います。

```sh
docker compose up --build
```

Docker Compose もリポジトリルートの `.env` を参照します。秘密値を含む `.env` はgit管理しません。

Discord 実接続には `DISCORD_TOKEN` と Message Content
Intent が必要です。DMは取り込まず、`guild_settings.target_channel_ids`
に含まれる公開チャンネルだけを対象にします。

## ドキュメント

- プロダクト企画: `proposal.md`
- Phase 1 仕様: `docs/specs/phase-1-dogfood-alpha.md`
- エージェント向け入口: `AGENTS.md`
- ハーネス運用: `docs/harness.md`
- 技術判断: `docs/adr/`
- 分類プロンプト: `docs/prompts/classification-v0.md`
- 自動返信プロンプト: `docs/prompts/auto-reply-v0.md`

ドキュメントは日本語で書きます。

## 品質ゲート

- TypeScript: `tsc --noEmit`
- Lint: ESLint
- Format: Prettier
- Test: Vitest
- Git hook: Lefthook pre-commit で `pnpm check`

## ライセンス

MIT
