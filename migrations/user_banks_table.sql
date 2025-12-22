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
-- Migration Complete
-- ================================================
-- 
-- This table enables:
-- - Deterministic tenant selection on server
-- - No dependency on Supabase Auth sessions
-- - Fast lookups by Clerk user ID
-- - Guaranteed single default bank per user
--
-- Next steps:
-- 1. Run this migration
-- 2. Verify indexes are created
-- 3. Test /api/banks/select endpoint
-- 4. Test /select-bank page flow
-- ================================================
