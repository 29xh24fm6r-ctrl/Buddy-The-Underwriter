-- crm_organizations, crm_people, crm_activities, and the lender_invoice*
-- tables had RLS enabled directly against production (confirmed live via
-- pg_class.relrowsecurity) with zero policies, but neither that ENABLE ROW
-- LEVEL SECURITY step nor any policy was ever captured in a migration.
-- Reconstructing it here so a fresh environment matches the live security
-- posture: fail-closed for anon/authenticated (app reads/writes these
-- exclusively via the service-role client, matching every other CRM table).

alter table public.crm_organizations enable row level security;
alter table public.crm_people enable row level security;
alter table public.crm_activities enable row level security;
alter table public.lender_invoices enable row level security;
alter table public.lender_invoice_line_items enable row level security;
alter table public.lender_invoice_payments enable row level security;
