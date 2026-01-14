-- ================================================
-- CURSOR SPEC ADD-ON: user_banks Mapping Table
-- ================================================
-- This migration creates a durable mapping between
-- Clerk users and banks/tenants for deterministic
-- tenant selection independent of auth sessions.
-- ================================================

-- 1) Mapping table from Clerk user -> bank/tenant
CREATE TABLE IF NOT EXISTS public.user_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  bank_id UUID NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Performance indexes
CREATE INDEX IF NOT EXISTS user_banks_clerk_user_id_idx
  ON public.user_banks (clerk_user_id);

CREATE INDEX IF NOT EXISTS user_banks_bank_id_idx
  ON public.user_banks (bank_id);

-- 3) Prevent duplicates (same user mapped to same bank multiple times)
CREATE UNIQUE INDEX IF NOT EXISTS user_banks_user_bank_unique
  ON public.user_banks (clerk_user_id, bank_id);

-- 4) Enforce at most one default bank per Clerk user
-- This is a partial unique index: only one row per clerk_user_id can have is_default = true
CREATE UNIQUE INDEX IF NOT EXISTS user_banks_one_default_per_user
  ON public.user_banks (clerk_user_id)
  WHERE (is_default = true);

-- ================================================
-- Verification Queries
-- ================================================

-- Check if table was created successfully
SELECT COUNT(*) as user_banks_count FROM user_banks;

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'user_banks';

-- ================================================
-- 5) Atomic "set default bank" function
-- ================================================
-- This function ensures atomicity - no race conditions
-- even with concurrent requests from the same user.

CREATE OR REPLACE FUNCTION public.set_default_bank(
  p_clerk_user_id TEXT,
  p_bank_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Clear existing default
  UPDATE public.user_banks
  SET is_default = false
  WHERE clerk_user_id = p_clerk_user_id
    AND is_default = true;

  -- Ensure row exists and set default = true
  INSERT INTO public.user_banks (clerk_user_id, bank_id, is_default)
  VALUES (p_clerk_user_id, p_bank_id, true)
  ON CONFLICT (clerk_user_id, bank_id)
  DO UPDATE SET is_default = true;
END;
$$;

-- ================================================
-- Migration Complete
-- ================================================
-- 
-- This table enables:
-- - Deterministic tenant selection on server
-- - No dependency on Supabase Auth sessions
-- - Fast lookups by Clerk user ID
-- - Guaranteed single default bank per user
-- - Atomic default bank switching (no race conditions)
--
-- Next steps:
-- 1. Run this migration
-- 2. Verify indexes are created
-- 3. Test /api/banks/select endpoint
-- 4. Test /select-bank page flow
-- ================================================
