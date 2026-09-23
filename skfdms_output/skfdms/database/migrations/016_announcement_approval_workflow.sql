-- Chairperson announcements require SK Federation review before public display.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by INTEGER,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_announcements_review
  ON announcements (barangay_id, approval_status, created_at DESC);
