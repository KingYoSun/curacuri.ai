CREATE TABLE llm_generation_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_type text NOT NULL CHECK (task_type IN ('classification', 'auto_reply', 'faq_candidates', 'weekly_report')),
  target_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  model_name text NOT NULL,
  error_code text,
  error_message text,
  raw_output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX llm_generation_runs_status_created_at_idx
  ON llm_generation_runs (status, created_at DESC);

CREATE INDEX llm_generation_runs_task_target_idx
  ON llm_generation_runs (task_type, target_id);
