begin;

-- 1) OCR page map per attachment (optional but unlocks true page overlays)
create table if not exists public.document_ocr_page_map (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  attachment_id uuid not null,
  page_number int not null,
  page_text text not null,
  -- char offsets into document_ocr_results.extracted_text (global text) for this page text
  global_char_start int not null default 0,
  global_char_end int not null default 0,
  created_at timestamptz not null default now(),
  unique(deal_id, attachment_id, page_number)
);

create index if not exists idx_page_map_deal_attachment on public.document_ocr_page_map(deal_id, attachment_id);
create index if not exists idx_page_map_deal_page on public.document_ocr_page_map(deal_id, page_number);

-- 2) Credit memo drafts (generated or banker-edited)
create table if not exists public.credit_memo_drafts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  version int not null default 1,
  title text not null default 'Credit Memo',
  body_md text not null,             -- markdown memo
  created_by_user_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_credit_memo_drafts_deal on public.credit_memo_drafts(deal_id);

-- 3) Memo citations: paragraph -> evidence span(s) and page anchors
create table if not exists public.credit_memo_citations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  memo_draft_id uuid not null,
  -- stable identifier for a memo block/paragraph (generated during memo build)
  block_id text not null,
  -- where evidence came from
  attachment_id uuid not null,
  page_number int null,
  -- highlight offsets into page_text AND global extracted_text (when available)
  page_char_start int null,
  page_char_end int null,
  global_char_start int null,
  global_char_end int null,
  label text null,
  confidence numeric(5,2) null check (confidence >= 0 and confidence <= 100),
  created_at timestamptz not null default now()
);

create index if not exists idx_memo_citations_deal on public.credit_memo_citations(deal_id);
create index if not exists idx_memo_citations_memo on public.credit_memo_citations(memo_draft_id);

commit;
