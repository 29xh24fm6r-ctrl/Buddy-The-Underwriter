-- 20251219_step15_upload_links_and_audit.sql

begin;

-- 1) Tokenized upload links (single-deal scope, expiry, optional password, optional single-use)
create table if not exists public.deal_upload_links (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  created_by uuid null, -- clerk/supabase user id if you store it; nullable
  created_at timestamptz not null default now(),

  token_hash text not null unique, -- sha256(token)
  expires_at timestamptz not null,
  revoked_at timestamptz null,

  single_use boolean not null default true,
  used_at timestamptz null,

  require_password boolean not null default false,
  password_hash text null, -- sha256(password + salt) or bcrypt if you prefer (we'll do sha for simplicity)
  password_salt text null,

  -- Optional metadata
  label text null,
  uploader_name_hint text null,
  uploader_email_hint text null
);

create index if not exists deal_upload_links_deal_id_idx on public.deal_upload_links(deal_id);
create index if not exists deal_upload_links_expires_idx on public.deal_upload_links(expires_at);

-- 2) Who uploaded what audit trail (covers borrower uploads and internal uploads)
create table if not exists public.deal_upload_audit (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,

  uploaded_at timestamptz not null default now(),
  uploaded_by_user uuid null, -- internal authenticated user id when applicable
  uploaded_via_link_id uuid null references public.deal_upload_links(id) on delete set null,

  uploader_type text not null check (uploader_type in ('internal','borrower','system')),
  uploader_display_name text null,
  uploader_email text null,

  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text null,
  size_bytes bigint null,

  client_ip text null,
  user_agent text null,

  -- link-scoped "facts"
  checklist_key text null,
  notes text null
);

create index if not exists deal_upload_audit_deal_id_idx on public.deal_upload_audit(deal_id);
create index if not exists deal_upload_audit_link_id_idx on public.deal_upload_audit(uploaded_via_link_id);

-- 3) A deal-scoped "uploads" table (optional but recommended) to unify UI.
-- If you already have a files table, you can skip this and map audit rows.
create table if not exists public.deal_files (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  created_at timestamptz not null default now(),

  storage_bucket text not null,
  storage_path text not null unique,

  original_filename text not null,
  mime_type text null,
  size_bytes bigint null,

  uploaded_by_user uuid null,
  uploaded_via_link_id uuid null references public.deal_upload_links(id) on delete set null,
  uploader_type text not null default 'internal' check (uploader_type in ('internal','borrower','system')),

  checklist_key text null
);

create index if not exists deal_files_deal_id_idx on public.deal_files(deal_id);

commit;
