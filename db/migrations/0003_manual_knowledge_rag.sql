CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE manual_knowledge (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('official_faq', 'docs', 'channel_guide', 'template_reply')),
  title text NOT NULL,
  body text NOT NULL,
  url text,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  embedding vector(1536),
  embedding_model text,
  embedding_updated_at timestamptz,
  embedding_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX manual_knowledge_guild_status_idx
  ON manual_knowledge (guild_id, status, updated_at DESC);

CREATE INDEX manual_knowledge_embedding_idx
  ON manual_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
