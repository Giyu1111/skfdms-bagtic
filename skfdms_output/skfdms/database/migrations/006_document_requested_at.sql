-- Add requested_at timestamp to track when SK chairman requested publication.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;

ALTER TABLE fund_proofs
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_documents_requested
  ON documents (barangay_id, publish_requested, requested_at);

CREATE INDEX IF NOT EXISTS idx_fund_proofs_requested
  ON fund_proofs (barangay_id, publish_requested, requested_at);