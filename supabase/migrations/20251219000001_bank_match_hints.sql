-- Bank-Wide Learning: Global Match Hints
-- Stores learned patterns across ALL deals in a bank
-- Provides priors for new deals, improves with every assignment bank-wide

begin;

create table if not exists public.bank_match_hints (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,

  -- learned signals (cross-deal patterns)
  doc_type text null,
  year int null,
  category text null,  -- "tax", "financial", "insurance", etc.

  filename_tokens text[] not null default '{}'::text[],
  keywords text[] not null default '{}'::text[],

  hit_count int not null default 1,
  last_used_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one hint "profile" per (bank, doc_type, year, category)
create unique index if not exists bank_match_hints_unique
  on public.bank_match_hints(bank_id, coalesce(doc_type,''), coalesce(year,0), coalesce(category,''));

create index if not exists bank_match_hints_bank_id_idx
  on public.bank_match_hints(bank_id);

commit;
