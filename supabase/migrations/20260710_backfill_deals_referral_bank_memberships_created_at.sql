-- Backfill tracked migration history for two columns already live in
-- production but never committed as migrations (same drift class as
-- 20260710_brk_billing_lender_invoices.sql):
--
--   deals.referral_source_org_id  — added for the CRM revenue-attribution
--     feature ("org detail includes deals it's attributed as referral
--     source for"). In production this column has
--     FOREIGN KEY (referral_source_org_id) REFERENCES crm_organizations(id)
--     ON DELETE SET NULL — omitted here because crm_organizations itself
--     has no migration anywhere in this repo (the whole CRM feature was
--     built directly against prod), so adding the FK would break a fresh
--     environment provisioned purely from migrations. Add the FK back once
--     crm_organizations gets its own migration.
--   bank_memberships.created_at   — row creation timestamp.
--
-- ADD COLUMN IF NOT EXISTS is a no-op against the current production
-- database (verified directly — both columns already exist with this
-- exact shape) while bringing fresh environments in line with prod.

alter table deals
  add column if not exists referral_source_org_id uuid;

alter table bank_memberships
  add column if not exists created_at timestamptz not null default now();
