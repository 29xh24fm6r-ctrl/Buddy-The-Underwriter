-- Phase 56D data fix: Normalize legacy membership roles and enforce constraints

-- 1. Drop the old CHECK constraint that only allows owner/admin/member/viewer
ALTER TABLE public.bank_memberships DROP CONSTRAINT IF EXISTS bank_memberships_role_check;

-- 2. Normalize legacy roles to canonical BuddyRole values
UPDATE public.bank_memberships SET role = 'bank_admin' WHERE role IN ('admin', 'owner');
UPDATE public.bank_memberships SET role = 'underwriter' WHERE role IN ('member', 'viewer');

-- 3. Set NOT NULL constraint
ALTER TABLE public.bank_memberships ALTER COLUMN role SET NOT NULL;

-- 4. Add new CHECK constraint with canonical BuddyRole values
ALTER TABLE public.bank_memberships ADD CONSTRAINT valid_buddy_role_check
  CHECK (role IN ('super_admin', 'bank_admin', 'underwriter', 'borrower', 'regulator_sandbox', 'examiner'));
