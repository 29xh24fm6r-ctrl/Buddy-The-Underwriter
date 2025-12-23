-- Create trigger on borrower_upload_extractions to auto-refresh deal snapshots
-- Uses existing trigger function: tg_refresh_snapshot_from_deal_id

drop trigger if exists tr_refresh_snapshot_upload_extractions on public.borrower_upload_extractions;

create trigger tr_refresh_snapshot_upload_extractions
after insert or update or delete on public.borrower_upload_extractions
for each row execute function public.tg_refresh_snapshot_from_deal_id();

-- One-time backfill (optional - refresh all existing deal snapshots)
-- Uncomment to run:
-- select public.refresh_deal_context_snapshot(id) from public.deals;
