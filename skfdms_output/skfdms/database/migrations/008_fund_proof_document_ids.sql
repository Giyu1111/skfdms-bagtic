-- Allow an accomplishment/fund proof to reference multiple published documents.
-- document_id remains as the first selected document for older code paths.
ALTER TABLE fund_proofs
  ADD COLUMN IF NOT EXISTS document_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
