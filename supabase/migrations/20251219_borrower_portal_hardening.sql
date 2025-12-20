begin;

-- ------------------------------------------------------------
-- Hardening: constraints + helpful indexes
-- ------------------------------------------------------------

-- Prevent duplicate active invites (optional but recommended):
-- One active invite per deal email (null email allowed; guarded by partial unique index).
create unique index if not exists borrower_invites_one_active_per_deal_email
on public.borrower_invites(deal_id, email)
where revoked_at is null;

-- Speed session lookup
create index if not exists borrower_portal_sessions_last_seen_idx
on public.borrower_portal_sessions(last_seen_at);

-- Messaging perf
create index if not exists borrower_messages_direction_idx
on public.borrower_messages(direction);

-- Requests perf
create index if not exists borrower_document_requests_bank_id_idx
on public.borrower_document_requests(bank_id);

-- Uploads perf
create index if not exists borrower_uploads_bank_id_idx
on public.borrower_uploads(bank_id);

commit;
