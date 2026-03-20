-- ============================================================
-- Clerk-compatible membership integrity (idempotent + safe)
-- - Keeps bank_memberships.user_id NOT NULL
-- - Fills user_id from profiles via clerk_user_id when missing
-- - Falls back to auth.uid() for direct Supabase-session inserts
-- - Hard-fails if all methods fail (prevents orphan rows)
--
-- Deployment order:
-- 1. Deploy API changes first (ensures new writes are correct)
-- 2. Run this migration (adds trigger + uniqueness, cleans bad rows)
-- 3. Smoke test create-bank + HeroBar
-- ============================================================

begin;

-- 0) Preflight: ensure clerk_user_id column exists (trigger depends on it)
alter table public.bank_memberships
  add column if not exists clerk_user_id text;

-- 1) Cleanup corrupt rows BEFORE constraints/indexes
delete from public.bank_memberships
where user_id is null;

-- 2) Enforce NOT NULL (re-apply if previously dropped)
alter table public.bank_memberships
  alter column user_id set not null;

-- 3) Trigger function: resolve membership.user_id from clerk_user_id -> profiles.id
create or replace function public.bank_memberships_fill_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  -- If user_id already provided, trust it
  if new.user_id is not null then
    return new;
  end if;

  -- Clerk path: resolve profiles.id from clerk_user_id
  if new.clerk_user_id is not null then
    select p.id
      into v_profile_id
    from public.profiles p
    where p.clerk_user_id = new.clerk_user_id
    limit 1;

    if v_profile_id is not null then
      new.user_id := v_profile_id;
      return new;
    end if;
  end if;

  -- Fallback: for direct Supabase client calls with a Supabase JWT
  new.user_id := auth.uid();

  if new.user_id is null then
    raise exception
      'bank_memberships.user_id required: provide user_id, or clerk_user_id matching profiles.clerk_user_id, or use authenticated Supabase session';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bank_memberships_fill_user_id on public.bank_memberships;

create trigger trg_bank_memberships_fill_user_id
before insert on public.bank_memberships
for each row
execute function public.bank_memberships_fill_user_id();

-- 4) Indexes (safe to create before unique constraint)
create index if not exists profiles_clerk_user_id_idx
on public.profiles (clerk_user_id);

create index if not exists bank_memberships_clerk_user_id_idx
on public.bank_memberships (clerk_user_id);

-- 5) Uniqueness via unique INDEX (idempotent, unlike ADD CONSTRAINT)
create unique index if not exists bank_memberships_bank_id_user_id_uniq
on public.bank_memberships (bank_id, user_id);

commit;
