-- Learning Loop: Match Hints Table
-- Stores learned patterns from manual assignments to improve ranking over time
-- Each deal builds its own "memory" of what works

begin;

create table if not exists public.borrower_match_hints (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  request_id uuid not null references public.borrower_document_requests(id) on delete cascade,

  -- learned signals
  doc_type text null,
  year int null,

  filename_tokens text[] not null default '{}'::text[],
  keywords text[] not null default '{}'::text[],

  hit_count int not null default 1,
  last_used_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one hint "profile" per (deal, request, doc_type, year)
create unique index if not exists borrower_match_hints_unique
  on public.borrower_match_hints(deal_id, request_id, coalesce(doc_type,''), coalesce(year,0));

create index if not exists borrower_match_hints_deal_id_idx
  on public.borrower_match_hints(deal_id);

create index if not exists borrower_match_hints_request_id_idx
  on public.borrower_match_hints(request_id);

commit;
