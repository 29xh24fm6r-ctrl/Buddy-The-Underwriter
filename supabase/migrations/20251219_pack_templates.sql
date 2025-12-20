begin;

-- ============================================================
-- Pack Templates System
-- ============================================================
-- Extends borrower portal with template-based request generation.
-- 
-- CANONICAL RULES:
-- 1. borrower_invites is ONLY borrower identity table (unchanged)
-- 2. token_hash is canonical (SHA256 base64url, unchanged)
-- 3. bank_id + deal_id required everywhere
-- 4. Packs NEVER create invites (they only create document requests)
-- 5. Packs ONLY create document requests (separation of concerns)
-- 6. Uploads NEVER attach without confidence ≥85%
-- ============================================================

-- ------------------------------------------------------------
-- Pack Templates (bank-level reusable bundles)
-- ------------------------------------------------------------
create table if not exists public.borrower_pack_templates (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  name text not null,
  loan_type text null,    -- exact match gets +70 points
  loan_program text null,  -- exact match gets +30 points
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrower_pack_templates_bank_id_idx 
  on public.borrower_pack_templates(bank_id);
create index if not exists borrower_pack_templates_active_idx 
  on public.borrower_pack_templates(active);

-- ------------------------------------------------------------
-- Pack Template Items (individual requests within a pack)
-- ------------------------------------------------------------
create table if not exists public.borrower_pack_template_items (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.borrower_pack_templates(id) on delete cascade,
  title text not null,
  category text null,
  description text null,
  doc_type text null,
  year_mode text null,  -- 'current', 'prior', 'both', null
  required boolean not null default true,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists borrower_pack_template_items_pack_id_idx 
  on public.borrower_pack_template_items(pack_id);

-- ------------------------------------------------------------
-- Enhance borrower_document_requests with pack tracking
-- ------------------------------------------------------------
alter table public.borrower_document_requests 
  add column if not exists source text null 
    check (source in ('manual', 'pack', 'ai'));

alter table public.borrower_document_requests 
  add column if not exists pack_id uuid null 
    references public.borrower_pack_templates(id) on delete set null;

alter table public.borrower_document_requests 
  add column if not exists pack_item_id uuid null 
    references public.borrower_pack_template_items(id) on delete set null;

alter table public.borrower_document_requests 
  add column if not exists sort_order int not null default 0;

create index if not exists borrower_document_requests_pack_id_idx 
  on public.borrower_document_requests(pack_id);
create index if not exists borrower_document_requests_source_idx 
  on public.borrower_document_requests(source);

-- ------------------------------------------------------------
-- Upload Inbox (staging area for auto-match with confidence)
-- ------------------------------------------------------------
create table if not exists public.borrower_upload_inbox (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  storage_path text not null,
  filename text not null,
  mime text null,
  bytes bigint null,
  
  -- Auto-match hints
  hinted_doc_type text null,
  hinted_category text null,
  
  -- Auto-match result
  matched_request_id uuid null references public.borrower_document_requests(id) on delete set null,
  match_confidence int null,  -- 0-100 score
  match_reason text null,     -- "doc_type match +70, category match +20"
  
  -- Status tracking
  status text not null default 'unmatched' 
    check (status in ('unmatched', 'attached', 'rejected')),
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrower_upload_inbox_deal_id_idx 
  on public.borrower_upload_inbox(deal_id);
create index if not exists borrower_upload_inbox_status_idx 
  on public.borrower_upload_inbox(status);
create index if not exists borrower_upload_inbox_matched_request_id_idx 
  on public.borrower_upload_inbox(matched_request_id);

-- ------------------------------------------------------------
-- Triggers: keep updated_at fresh
-- ------------------------------------------------------------
drop trigger if exists trg_touch_pack_templates on public.borrower_pack_templates;
create trigger trg_touch_pack_templates
before update on public.borrower_pack_templates
for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_upload_inbox on public.borrower_upload_inbox;
create trigger trg_touch_upload_inbox
before update on public.borrower_upload_inbox
for each row execute function public.touch_updated_at();

commit;

