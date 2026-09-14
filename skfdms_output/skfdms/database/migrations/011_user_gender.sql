-- Store the gender selected when registering SK officials.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
