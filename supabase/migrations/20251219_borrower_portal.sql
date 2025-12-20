begin;

-- ------------------------------------------------------------
-- Borrower Portal v1 (token-based access)
-- - borrower_invites: issue expiring portal links per deal
-- - borrower_portal_sessions: optional audit trail
-- - borrower_messages: portal messaging thread
-- - borrower_document_requests: "missing docs" list visible in portal
-- - borrower_uploads: file metadata tied to requests (optional)
-- ------------------------------------------------------------

create table if not exists public.borrower_invites (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  created_by uuid null, -- auth.uid() of banker
  email text null,
  name text null,
  token_hash text not null, -- store sha256(token)
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists borrower_invites_deal_id_idx on public.borrower_invites(deal_id);
create index if not exists borrower_invites_bank_id_idx on public.borrower_invites(bank_id);
create index if not exists borrower_invites_expires_at_idx on public.borrower_invites(expires_at);

create table if not exists public.borrower_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.borrower_invites(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  ip text null,
  user_agent text null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists borrower_portal_sessions_invite_id_idx on public.borrower_portal_sessions(invite_id);
create index if not exists borrower_portal_sessions_deal_id_idx on public.borrower_portal_sessions(deal_id);

create table if not exists public.borrower_messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  invite_id uuid null references public.borrower_invites(id) on delete set null,
  direction text not null check (direction in ('borrower','bank')),
  author_name text null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists borrower_messages_deal_id_idx on public.borrower_messages(deal_id);
create index if not exists borrower_messages_created_at_idx on public.borrower_messages(created_at);

create table if not exists public.borrower_document_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  title text not null,
  description text null,
  category text null,
  status text not null default 'requested' check (status in ('requested','uploaded','accepted','rejected')),
  due_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrower_document_requests_deal_id_idx on public.borrower_document_requests(deal_id);
create index if not exists borrower_document_requests_status_idx on public.borrower_document_requests(status);

create table if not exists public.borrower_uploads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  request_id uuid null references public.borrower_document_requests(id) on delete set null,
  storage_bucket text not null default 'borrower_uploads',
  storage_path text not null,
  original_filename text not null,
  mime_type text null,
  size_bytes bigint null,
  uploaded_at timestamptz not null default now()
);

create index if not exists borrower_uploads_deal_id_idx on public.borrower_uploads(deal_id);
create index if not exists borrower_uploads_request_id_idx on public.borrower_uploads(request_id);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_borrower_document_requests on public.borrower_document_requests;
create trigger trg_touch_borrower_document_requests
before update on public.borrower_document_requests
for each row execute function public.touch_updated_at();

commit;
