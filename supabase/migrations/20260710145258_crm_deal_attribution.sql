-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- applied directly to the production project and never committed to the
-- repo. Captured verbatim for governance/reproducibility (see CRM audit,
-- 2026-07-16).

-- Ties CRM relationships to actual revenue — the piece that was
-- completely missing. Nothing previously connected a referral source
-- to the deals it sent the brokerage, which is the single most
-- important signal a lending-relationship CRM needs to surface: which
-- relationships are actually worth the time.

alter table deals
  add column referral_source_org_id uuid references crm_organizations(id) on delete set null;

create index idx_deals_referral_source_org_id
  on deals(referral_source_org_id)
  where referral_source_org_id is not null;
