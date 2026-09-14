-- Per-user profile image support for PostgreSQL/Supabase.
-- Stores a relative path (from the uploads root) to the user's
-- profile photo, served via the /uploads static mount.
-- Example stored value: "2024/1724000000_profile.jpg"

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_image VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_users_profile_image
  ON users (profile_image)
 WHERE profile_image IS NOT NULL;
