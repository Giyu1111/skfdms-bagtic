-- Details and documentary evidence submitted with an SK chairperson registration request.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS residential_address TEXT,
  ADD COLUMN IF NOT EXISTS appointment_basis VARCHAR(40),
  ADD COLUMN IF NOT EXISTS term_start DATE,
  ADD COLUMN IF NOT EXISTS term_end DATE,
  ADD COLUMN IF NOT EXISTS supporting_document_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS supporting_document_name VARCHAR(255);
