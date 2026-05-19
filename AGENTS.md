# AGENTS.md

このリポジトリは Codex 中心の開発を前提にしています。このファイルはマニュアルではなく、短い地図として保ってください。

## 最初に読む場所

- プロダクト文脈: `proposal.md`
- ハーネス運用: `docs/harness.md`
- アーキテクチャ判断: `docs/adr/`

## コマンド

- 依存関係のインストール: `pnpm install`
- ローカルの総合チェック: `pnpm check`
- 型チェック: `pnpm typecheck`
- Lint: `pnpm lint`
- フォーマット確認: `pnpm format:check`
- テスト: `pnpm test`

## 作業ルール

- コード変更を引き渡す前に `pnpm check` を実行する。
- ドキュメントは日本語で書く。
- 長く残る技術判断は `docs/adr/` に ADR として記録する。
- 文章だけの指示より、テスト・型・リンター・フックによる決定的なチェックを優先する。
- ADR または明示的な依頼なしに、アプリ API、DB schema、Redis queue 名を追加しない。
- エージェント向け指示は短く保ち、バージョン管理された信頼できる情報源へ誘導する。
