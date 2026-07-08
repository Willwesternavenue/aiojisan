-- System alerts surfaced on the admin dashboard (e.g. image-generation
-- credit depletion). NOTE: already applied to production manually.

CREATE TABLE system_alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source     TEXT NOT NULL,          -- 'gemini' | 'openai'
  kind       TEXT NOT NULL,          -- 'quota'
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_alerts_created_at ON system_alerts(created_at DESC);

-- Server-only table: app reads/writes via service role (bypasses RLS).
-- Enable RLS with no policies so anon/authenticated roles have zero access.
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
