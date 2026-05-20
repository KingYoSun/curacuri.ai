# Phase 1 Dogfood Alpha 実装ログ

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
