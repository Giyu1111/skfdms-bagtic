-- User approval workflow for PostgreSQL/Supabase.
-- Run this after 001_create_tables.sql on an existing database.

DO $$
DECLARE
  role_type regtype;
BEGIN
  SELECT a.atttypid::regtype
    INTO role_type
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE a.attrelid = 'users'::regclass
     AND a.attname = 'role'
     AND t.typtype = 'e';

  IF role_type IS NOT NULL THEN
    EXECUTE format('ALTER TYPE %s ADD VALUE IF NOT EXISTS %L', role_type, 'councilor');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'users_approval_status_check'
       AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'declined'));
  END IF;
END $$;

UPDATE users
   SET approval_status = 'approved'
 WHERE approval_status IS NULL;

UPDATE users
   SET is_active = false
 WHERE approval_status IN ('pending', 'declined');
