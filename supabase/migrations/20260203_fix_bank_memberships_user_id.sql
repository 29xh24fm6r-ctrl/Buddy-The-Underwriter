-- Fix bank_memberships to work with Clerk auth (not Supabase auth)
-- The user_id column was for Supabase auth.uid() but we use clerk_user_id now.

-- Make user_id nullable since we use clerk_user_id as the primary identifier
ALTER TABLE public.bank_memberships
  ALTER COLUMN user_id DROP NOT NULL;

-- Ensure clerk_user_id column exists and is indexed
ALTER TABLE public.bank_memberships
  ADD COLUMN IF NOT EXISTS clerk_user_id text;

CREATE INDEX IF NOT EXISTS idx_bank_memberships_clerk_user_id
  ON public.bank_memberships(clerk_user_id);

-- Add unique constraint on (bank_id, clerk_user_id) to prevent duplicates
-- Drop existing if any, then create
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bank_memberships_bank_clerk_unique'
  ) THEN
    ALTER TABLE public.bank_memberships
      ADD CONSTRAINT bank_memberships_bank_clerk_unique
      UNIQUE (bank_id, clerk_user_id);
  END IF;
EXCEPTION WHEN others THEN
  -- Ignore if constraint already exists or can't be created
  NULL;
END $$;
