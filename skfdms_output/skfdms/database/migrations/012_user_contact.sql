-- Store contact information for SK officials and registration requests.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS contact VARCHAR(100);
