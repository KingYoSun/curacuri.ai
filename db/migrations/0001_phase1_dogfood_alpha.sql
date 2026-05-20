CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE guild_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id text NOT NULL UNIQUE,
  target_channel_ids text[] NOT NULL DEFAULT '{}',
  excluded_channel_ids text[] NOT NULL DEFAULT '{}',
  admin_notification_channel_id text NOT NULL,
  retention_days integer NOT NULL DEFAULT 90,
  character_name text NOT NULL DEFAULT 'クラクリAI',
  character_tone text NOT NULL DEFAULT '丁寧な書記',
  auto_reply_mode text NOT NULL CHECK (auto_reply_mode IN ('disabled', 'intake_only', 'faq_assist', 'approval_required')),
  auto_reply_allowed_channel_ids text[] NOT NULL DEFAULT '{}',
  auto_reply_allowed_labels text[] NOT NULL DEFAULT ARRAY['質問', '新規参加者の困りごと', '高価値UGC'],
  auto_reply_allowed_categories text[] NOT NULL DEFAULT ARRAY['intake', 'channel_guide', 'faq_reference'],
  auto_reply_escalation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_reply_min_confidence numeric NOT NULL DEFAULT 0.80,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source text NOT NULL CHECK (source IN ('discord', 'sample_log')),
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  channel_name text NOT NULL,
  message_id text NOT NULL,
  thread_id text,
  author_id_hash text NOT NULL,
  content text NOT NULL,
  posted_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (source, guild_id, message_id)
);

CREATE TABLE classifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id uuid NOT NULL REFERENCES messages(id),
  labels text[] NOT NULL CHECK (array_length(labels, 1) > 0),
  importance text NOT NULL CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  admin_action_needed boolean NOT NULL,
  admin_action_type text NOT NULL CHECK (admin_action_type IN ('none', 'weekly_report', 'reply_check', 'bug_triage', 'faq_candidate', 'announcement_check', 'privacy_or_rule_check')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reason text NOT NULL,
  suggested_summary text NOT NULL,
  model_name text NOT NULL,
  raw_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_type text NOT NULL CHECK (notification_type IN ('official_reply', 'bug_cluster', 'complaint_increase', 'misinformation', 'fire_risk', 'privacy_or_rule', 'unanswered_question')),
  message_ids uuid[] NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  importance text NOT NULL CHECK (importance IN ('high', 'critical')),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'dismissed', 'failed')),
  sent_to_channel_id text NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auto_reply_policies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL CHECK (mode IN ('disabled', 'intake_only', 'faq_assist', 'approval_required')),
  allowed_channel_ids text[] NOT NULL DEFAULT '{}',
  allowed_labels text[] NOT NULL DEFAULT ARRAY['質問', '新規参加者の困りごと', '高価値UGC'],
  allowed_categories text[] NOT NULL DEFAULT ARRAY['intake', 'channel_guide', 'faq_reference'],
  blocked_categories text[] NOT NULL DEFAULT ARRAY['legal', 'pr', 'pricing', 'incident', 'roadmap', 'account', 'security'],
  min_confidence numeric NOT NULL DEFAULT 0.80,
  require_source_for_faq boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auto_reply_escalation_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('label', 'category', 'keyword', 'importance', 'confidence', 'official_needed', 'privacy_or_rule')),
  condition jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('notify_admin', 'draft_for_approval', 'do_not_reply')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auto_replies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id uuid NOT NULL REFERENCES messages(id),
  classification_id uuid NOT NULL REFERENCES classifications(id),
  mode text NOT NULL CHECK (mode IN ('disabled', 'intake_only', 'faq_assist', 'approval_required')),
  reply_category text NOT NULL CHECK (reply_category IN ('intake', 'channel_guide', 'faq_reference', 'clarifying_question', 'approved_answer')),
  body text NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  decision_reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('drafted', 'pending_approval', 'sent', 'escalated', 'blocked', 'failed')),
  sent_message_id text,
  approved_by text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faq_candidates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_message_ids uuid[] NOT NULL,
  topic text NOT NULL,
  current_answer_status text NOT NULL CHECK (current_answer_status IN ('unknown', 'answered_in_thread', 'needs_official_answer', 'existing_faq_possible')),
  draft_question text NOT NULL,
  draft_answer text NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL CHECK (status IN ('candidate', 'accepted', 'rejected', 'needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE weekly_reports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  target_channel_ids text[] NOT NULL,
  excluded_channel_ids text[] NOT NULL,
  message_count integer NOT NULL,
  short_body text NOT NULL,
  detailed_body text NOT NULL,
  metrics jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_feedback (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type text NOT NULL CHECK (target_type IN ('classification', 'notification', 'faq_candidate', 'weekly_report', 'auto_reply')),
  target_id uuid NOT NULL,
  feedback_kind text NOT NULL CHECK (feedback_kind IN ('useful', 'unnecessary', 'misclassified', 'missed', 'unsafe_or_too_much', 'needs_escalation')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
