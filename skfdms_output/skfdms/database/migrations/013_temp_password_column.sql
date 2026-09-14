-- Store the temporary password for display in admin UI.
-- The temp password is generated during approval/reset and shown
-- to the SK Fed admin for sharing with the chairperson.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS temp_password TEXT;
