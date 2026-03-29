-- Phase 58A: SBA Risk Profiles — computed composite risk per deal
CREATE TABLE IF NOT EXISTS buddy_sba_risk_profiles (
  id                       uuid primary key default gen_random_uuid(),
  deal_id                  uuid not null references deals(id) on delete cascade,
  computed_at              timestamptz not null default now(),
  loan_type                text not null,
  naics_code               text,
  industry_factor          jsonb not null default '{}',
  business_age_factor      jsonb not null default '{}',
  loan_term_factor         jsonb not null default '{}',
  urban_rural_factor       jsonb not null default '{}',
  composite_risk_score     numeric(4,2) not null,
  composite_risk_tier      text not null,
  composite_narrative      text,
  requires_projected_dscr  boolean not null default false,
  projected_dscr_threshold numeric(4,2),
  equity_injection_floor   numeric(4,2),
  hard_blockers            jsonb not null default '[]',
  soft_warnings            jsonb not null default '[]',
  UNIQUE(deal_id)
);

ALTER TABLE buddy_sba_risk_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_scoped_sba_risk_profiles" ON buddy_sba_risk_profiles
  USING (
    deal_id IN (
      SELECT id FROM deals WHERE bank_id = (
        SELECT bank_id FROM bank_users WHERE user_id = auth.uid() LIMIT 1
      )
    )
  );
CREATE INDEX idx_sba_risk_profiles_deal_id ON buddy_sba_risk_profiles(deal_id);
