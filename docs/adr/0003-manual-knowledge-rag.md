# ADR 0003: 手動ナレッジとRAG検索

## ステータス

採用

## 文脈

Phase 1 Dogfood Alpha の `faq_assist`
は、過去投稿から生成されたFAQ候補だけを参照していた。この状態では、運営者がすでに持っている公式FAQ、Docs、チャンネル案内、定型回答を安全な参照元として使えない。

P1の運用品質として、手動登録された公式情報ソースをFAQ候補とは分離して扱い、補助返信では信頼できる参照元がある場合だけ使う必要がある。

## 決定

- `manual_knowledge` テーブルを追加し、公式FAQ、Docs、チャンネル案内、定型回答を保存する。
- 手動ナレッジは `draft`、`published`、`archived` の状態を持ち、`faq_assist` では `published`
  だけを参照する。
- PostgreSQL の pgvector を使い、手動ナレッジ本文のembeddingを保存する。
- Embeddings は OpenAI Compatible API で生成し、初期モデルは `text-embedding-3-small`、次元数は
  `1536` とする。
- `faq_assist` では投稿本文をembedding化し、cosine
  distanceで検索した手動ナレッジを承認済みFAQ候補と合わせて最大3件までLLMに渡す。
- 類似度が低い参照元を避けるため、similarity `0.25` 未満の手動ナレッジは使わない。
- 新しいRedis
  queueは追加せず、Dashboard/API操作時に同期的にembeddingを生成する。失敗時は保存自体を失敗させず、`embedding_error`
  として記録する。

## 影響

- 運営者はFAQ候補とは別に、公式情報ソースを明示的に登録、編集、公開、アーカイブできる。
- `faq_assist` の返信は、過去投稿由来の候補だけでなく、運営者が管理する公式ナレッジにも基づける。
- 既存DB volumeにはinitdb migrationが自動再適用されないため、既存環境では
  `db/migrations/0003_manual_knowledge_rag.sql` の手動適用またはvolume再作成が必要になる。
