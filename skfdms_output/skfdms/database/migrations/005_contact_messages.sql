-- Public contact messages for the admin notification inbox.
-- Run this after the base PostgreSQL/Supabase schema migrations.

CREATE TABLE IF NOT EXISTS contact_messages (
  id          BIGSERIAL PRIMARY KEY,
  barangay_id INT NOT NULL REFERENCES barangays(id) ON DELETE CASCADE,
  first_name  VARCHAR(80) NOT NULL,
  last_name   VARCHAR(80),
  email       VARCHAR(180) NOT NULL,
  subject     VARCHAR(160) NOT NULL,
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_barangay_created
  ON contact_messages (barangay_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_messages_unread
  ON contact_messages (is_read, created_at DESC);
