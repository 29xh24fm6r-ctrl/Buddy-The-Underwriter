begin;

-- Ensure you can efficiently list files by deal
create index if not exists deal_files_created_at_idx
  on public.deal_files(deal_id, created_at desc);

commit;
