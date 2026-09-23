-- Archived announcements are hidden from normal and public listings.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_announcements_archive_scope
  ON announcements (barangay_id, is_archived, created_at DESC);
