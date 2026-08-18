-- Bind every final Golden Trident release to the exact memo, spread, and
-- canonical memo input hash that passed the release gate.
alter table public.buddy_trident_bundles
  add column if not exists source_credit_memo_id uuid references public.canonical_memo_narratives(id),
  add column if not exists source_spread_id uuid references public.deal_spreads(id),
  add column if not exists canonical_memo_input_hash text,
  add column if not exists release_gate_json jsonb;

create index if not exists buddy_trident_bundles_credit_memo_idx
  on public.buddy_trident_bundles(source_credit_memo_id);

comment on column public.buddy_trident_bundles.release_gate_json is
  'Fail-closed deterministic release verdict and reasons for this immutable artifact run.';
