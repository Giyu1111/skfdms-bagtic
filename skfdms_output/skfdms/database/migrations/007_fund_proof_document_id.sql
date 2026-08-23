-- Link fund_proofs to a published document so the budget
-- (amount) can be traced to the document it supports.

ALTER TABLE fund_proofs
  ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fund_proofs_document_id
  ON fund_proofs (document_id) WHERE document_id IS NOT NULL;
