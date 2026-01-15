-- ================================================
-- Buddy Auth Fix: Clerk User ID Migration
-- ================================================
-- This migration adds Clerk user IDs to enable
-- Clerk-based authentication without Supabase Auth
-- ================================================

-- ================================================
-- 1. Add clerk_user_id to profiles table
-- ================================================

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

-- Make it unique (one Clerk user = one profile)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_clerk_user_id_unique 
ON profiles(clerk_user_id) 
WHERE clerk_user_id IS NOT NULL;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_user_id 
ON profiles(clerk_user_id);

-- Add timestamps if missing
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS bank_selected_at TIMESTAMPTZ;

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS last_bank_id UUID;

-- ================================================
-- 2. Add clerk_user_id to bank_memberships table
-- ================================================

ALTER TABLE bank_memberships 
ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_bank_memberships_clerk_user_id 
ON bank_memberships(clerk_user_id);

-- ================================================
-- 3. (Optional) Data Migration
-- ================================================
-- If you have existing users with Supabase user IDs,
-- you need to map them to Clerk user IDs.
--
-- This requires either:
-- A) Exporting Clerk users and matching by email
-- B) Using Clerk API to look up users by email
-- C) Having users sign in again and auto-creating mappings
--
-- Example (requires a temporary clerk_users_mapping table):

-- CREATE TEMP TABLE clerk_users_mapping (
--   supabase_user_id UUID,
--   clerk_user_id TEXT,
--   email TEXT
-- );

-- -- Import data from Clerk export or API
-- -- COPY clerk_users_mapping FROM 'clerk_export.csv' CSV HEADER;

-- -- Update profiles
-- UPDATE profiles p
-- SET clerk_user_id = m.clerk_user_id
-- FROM clerk_users_mapping m
-- WHERE p.id = m.supabase_user_id
--   AND p.clerk_user_id IS NULL;

-- -- Update bank_memberships
-- UPDATE bank_memberships bm
-- SET clerk_user_id = m.clerk_user_id
-- FROM clerk_users_mapping m
-- WHERE bm.user_id = m.supabase_user_id
--   AND bm.clerk_user_id IS NULL;

-- ================================================
-- 4. Verification Queries
-- ================================================

-- Check profiles without Clerk user ID
SELECT COUNT(*) as profiles_missing_clerk_id
FROM profiles 
WHERE clerk_user_id IS NULL;

-- Check bank_memberships without Clerk user ID
SELECT COUNT(*) as memberships_missing_clerk_id
FROM bank_memberships 
WHERE clerk_user_id IS NULL;

-- Verify no duplicate Clerk user IDs in profiles
SELECT clerk_user_id, COUNT(*) 
FROM profiles 
WHERE clerk_user_id IS NOT NULL
GROUP BY clerk_user_id 
HAVING COUNT(*) > 1;

-- ================================================
-- 5. (Optional) Add RLS Policies for Clerk JWTs
-- ================================================
-- If you want database-level security using Clerk JWTs,
-- you can add RLS policies. For now, we rely on
-- application-level security with the admin client.
--
-- Future enhancement example:

-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view own profile"
-- ON profiles FOR SELECT
-- USING (clerk_user_id = auth.jwt() ->> 'sub');

-- CREATE POLICY "Users can update own profile"
-- ON profiles FOR UPDATE
-- USING (clerk_user_id = auth.jwt() ->> 'sub');

-- ================================================
-- 6. Cleanup (Optional)
-- ================================================
-- After confirming the migration works, you may want to
-- make clerk_user_id NOT NULL and drop old columns.
--
-- WARNING: Only run this after verifying all users are migrated!

-- -- Make clerk_user_id required
-- ALTER TABLE profiles 
-- ALTER COLUMN clerk_user_id SET NOT NULL;

-- ALTER TABLE bank_memberships 
-- ALTER COLUMN clerk_user_id SET NOT NULL;

-- -- Optionally drop old Supabase user_id references
-- -- (be very careful with foreign key constraints)
-- -- ALTER TABLE bank_memberships DROP COLUMN user_id;

-- ================================================
-- Migration Complete
-- ================================================
-- 
-- Next steps:
-- 1. Run this migration in your database
-- 2. Verify counts from verification queries
-- 3. Test with /api/debug/clerk endpoint
-- 4. Test bank selection flow
-- 5. Deploy application code changes
-- ================================================
