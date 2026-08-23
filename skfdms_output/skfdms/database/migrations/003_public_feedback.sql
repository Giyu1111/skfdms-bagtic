-- Public community feedback for the Community page.
-- Run this after the base PostgreSQL/Supabase schema migrations.

CREATE TABLE IF NOT EXISTS public_feedback (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL DEFAULT 'Anonymous',
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message     TEXT NOT NULL,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_feedback_created_at
  ON public_feedback (created_at DESC);
