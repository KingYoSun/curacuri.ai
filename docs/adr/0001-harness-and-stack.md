# ADR 0001: 最小実行可能ハーネスと初期スタック

## ステータス

採用

## 文脈

curacuri.ai は企画書中心のリポジトリから開始する。アプリケーションコードを追加する前に、Codex と人間の開発者が使える安定した入口、速いフィードバック、長く残る技術判断を提供する小さなハーネスが必要である。

プロダクト企画書では、初期実装の方向性を TypeScript、Hono、Vite、Redis、Discord 中心のバックエンドとして定めている。ハーネスはこの方向性を支えつつ、アプリケーション API、データベーススキーマ、queue 契約を早すぎる段階で定義しない。

参考:

- OpenAI, "Harness engineering: using Codex in an agent-first world":
  https://openai.com/ja-JP/index/harness-engineering/
- Nyosegawa, "Claude Code / Codex ユーザーのための誰でもわかるHarness
  Engineeringベストプラクティス":
  https://nyosegawa.com/posts/harness-engineering-best-practices-2026/

## 決定

- ルートの短い `AGENTS.md` を Codex 向けのポインタファイルとして使う。
- `docs/` をリポジトリのナレッジベースとして使う。
- `docs/adr/` の ADR を、長く残る技術判断の記録として使う。
- パッケージマネージャーは pnpm を使う。
- 初期ランタイムの基準は TypeScript と Node.js にする。
- 最初の決定的な品質ゲートとして ESLint、Prettier、Vitest、Lefthook を使う。
- ローカル引き渡しゲートを `pnpm check` に統一する。
- Hono、Vite、Redis、BullMQ、PostgreSQL、pgvector は今後のアプリケーション作業に向けたスタック判断として維持する。ただし、このハーネス変更ではアプリケーション契約を導入しない。

## 影響

- 新しい開発者とエージェントが、小さく安定した入口を持てる。
- CI 導入前でも、ローカルで品質フィードバックを得られる。
- 今後スタックを変更する場合は ADR の更新が必要になる。
- リポジトリは、巨大な指示ファイルや腐りやすい文章だけのルールを避けられる。
