-- Public document engagement counters for PostgreSQL/Supabase.
-- preview_count tracks inline previews; download_count tracks file downloads.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS preview_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0;
