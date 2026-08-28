-- Lender relationships, deal distribution decisions, and response notes are
-- brokerage-private. All access flows through brokerage-staff-gated server
-- routes using service_role; browser roles must not reach these tables.

revoke all on table public.crm_lender_profiles from anon, authenticated;
revoke all on table public.crm_deal_lender_submissions from anon, authenticated;
revoke all on table public.crm_lender_submission_events from anon, authenticated;

grant select, insert, update, delete on table public.crm_lender_profiles to service_role;
grant select, insert, update, delete on table public.crm_deal_lender_submissions to service_role;
grant select, insert, update, delete on table public.crm_lender_submission_events to service_role;
