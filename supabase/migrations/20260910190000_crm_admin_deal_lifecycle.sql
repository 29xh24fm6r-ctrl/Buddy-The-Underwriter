-- Extend the service-only deletion receipt ledger to brokerage deals.
-- Deal archiving uses the existing deals.archived_at lifecycle; only an
-- irreversible deletion creates a receipt containing the final snapshot.

alter table public.crm_admin_deletion_log
  drop constraint if exists crm_admin_deletion_log_entity_type_check;

alter table public.crm_admin_deletion_log
  add constraint crm_admin_deletion_log_entity_type_check
  check (entity_type in ('organization', 'person', 'lead', 'activity', 'deal'));
