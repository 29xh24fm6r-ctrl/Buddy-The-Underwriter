-- Production reconciliation for brokerage deal deletion receipts.
--
-- The original audit-ledger migration predates deal deletion and its
-- entity_type check only admitted CRM contacts, leads, and activities. Keep
-- the ledger fail-closed while making the later deal contract repeat-safe for
-- production databases whose migration history was applied selectively.

alter table public.crm_admin_deletion_log
  drop constraint if exists crm_admin_deletion_log_entity_type_check;

alter table public.crm_admin_deletion_log
  add constraint crm_admin_deletion_log_entity_type_check
  check (entity_type in ('organization', 'person', 'lead', 'activity', 'deal'));

alter table public.crm_admin_deletion_log enable row level security;
revoke all on table public.crm_admin_deletion_log from anon, authenticated;
grant all on table public.crm_admin_deletion_log to service_role;
