-- Document archive inventory for PostgreSQL/Supabase.
-- Archived documents are kept in storage and hidden from normal/public lists.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_archive_scope
  ON documents (is_archived, barangay_id, created_at DESC);
