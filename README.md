# curacuri.ai

curacuri.ai（クラクリAI）は、少数精鋭で公式 Discord を長期運営するチームのための、AI 書記・受付・運営補佐キャラクターです。

Discord サーバー内の質問、要望、不満、バグ報告、盛り上がりを整理し、週次レポート・重要通知・FAQ 候補・VOC 分析として運営者に届けることで、公式コミュニティ運営の認知負荷を下げることを目指します。

## 現在の状態

このリポジトリは、アプリケーション本体の実装前段階です。現在は Codex 中心の開発を始めるための最小実行可能ハーネスを整備しています。

まだ以下は定義していません。

- アプリケーション API
- データベーススキーマ
- Redis queue 名
- Discord Bot の具体的な振る舞い
- デプロイ構成

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
```

## 開発コマンド

```sh
pnpm check
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

`pnpm check`
は、型チェック、Lint、フォーマット確認、テストをまとめて実行するローカルの総合チェックです。

## ドキュメント

- プロダクト企画: `proposal.md`
- エージェント向け入口: `AGENTS.md`
- ハーネス運用: `docs/harness.md`
- 技術判断: `docs/adr/`

ドキュメントは日本語で書きます。

## 品質ゲート

- TypeScript: `tsc --noEmit`
- Lint: ESLint
- Format: Prettier
- Test: Vitest
- Git hook: Lefthook pre-commit で `pnpm check`

## ライセンス

MIT
