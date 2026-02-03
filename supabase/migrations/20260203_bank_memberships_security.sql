-- ============================================================
-- Clerk-compatible membership integrity
-- - Keeps bank_memberships.user_id NOT NULL
-- - Fills user_id from profiles via clerk_user_id when missing
-- - Optionally falls back to auth.uid() for Supabase-session inserts
-- - Hard-fails if all methods fail (prevents orphan rows)
-- ============================================================

begin;

-- 0) Clean up any existing corrupt rows
delete from public.bank_memberships
where user_id is null;

-- 1) Ensure NOT NULL is enforced (re-apply if previously dropped)
alter table public.bank_memberships
  alter column user_id set not null;

-- 2) Ensure the clerk_user_id column exists on bank_memberships
alter table public.bank_memberships
  add column if not exists clerk_user_id text;

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
  -- If user_id already provided, trust it.
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

  -- Optional fallback: for direct Supabase client calls with a Supabase JWT
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

-- 4) Prevent duplicates: same user joins same bank twice
create unique index if not exists bank_memberships_bank_id_user_id_uniq
on public.bank_memberships (bank_id, user_id);

-- 5) Speed up clerk lookups
create index if not exists profiles_clerk_user_id_idx
on public.profiles (clerk_user_id);

-- 6) Index for clerk_user_id lookups on bank_memberships
create index if not exists idx_bank_memberships_clerk_user_id
on public.bank_memberships (clerk_user_id);

commit;
