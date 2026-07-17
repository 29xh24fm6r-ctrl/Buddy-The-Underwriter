-- duplicate_index (Supabase advisor, WARN, 18 findings): identical index
-- definitions (same table, columns, and predicate) created twice under
-- different names -- pure redundancy, each duplicate costs write
-- overhead and disk space for zero additional query benefit. Keeping
-- exactly one per group; verified via pg_constraint that
-- bank_memberships_bank_id_user_id_key backs a real UNIQUE constraint
-- (kept) while its duplicate bank_memberships_bank_id_user_id_uniq is a
-- standalone index (dropped). The other unique pair
-- (deal_spread_jobs_one_active_per_deal / idx_spread_jobs_active_deal)
-- has neither side backing a constraint, so either is safe to drop.
DROP INDEX IF EXISTS public.idx_deal_outbound_ledger_fingerprint;
DROP INDEX IF EXISTS public.idx_borrower_portal_links_token;
DROP INDEX IF EXISTS public.profiles_bank_id_idx;
DROP INDEX IF EXISTS public.profiles_clerk_user_id_idx;
DROP INDEX IF EXISTS public.deal_reminder_subscriptions_deal_idx;
DROP INDEX IF EXISTS public.deal_documents_deal_checklist_idx;
DROP INDEX IF EXISTS public.idx_deal_docs_deal_checklist_key;
DROP INDEX IF EXISTS public.idx_deal_docs_deal_doc_year;
DROP INDEX IF EXISTS public.deal_checklist_items_key_idx;
DROP INDEX IF EXISTS public.idx_bank_memberships_clerk_user_id;
DROP INDEX IF EXISTS public.bank_memberships_bank_id_user_id_uniq;
DROP INDEX IF EXISTS public.borrower_upload_inbox_matched_request_idx;
DROP INDEX IF EXISTS public.idx_timeline_deal;
DROP INDEX IF EXISTS public.idx_owner_requirements_deal;
DROP INDEX IF EXISTS public.idx_ai_events_deal_id;
DROP INDEX IF EXISTS public.idx_deal_pipeline_ledger_bank_created;
DROP INDEX IF EXISTS public.idx_spread_jobs_active_deal;
DROP INDEX IF EXISTS public.idx_lender_invoices_bank;
DROP INDEX IF EXISTS public.idx_lender_invoices_lender_bank;
