-- SPEC-B4 — deal_methodology_choices table
-- Stores banker variant choices per methodology axis per deal.
-- One row per (deal_id, bank_id, axis). No row = use default variant.

CREATE TABLE IF NOT EXISTS deal_methodology_choices (
  deal_id            uuid    NOT NULL,
  bank_id            uuid    NOT NULL,
  axis               text    NOT NULL,
  variant            text    NOT NULL,
  chosen_at          timestamptz NOT NULL DEFAULT now(),
  chosen_by_user_id  uuid    NULL,
  reason             text    NULL,
  PRIMARY KEY (deal_id, bank_id, axis),
  CONSTRAINT fk_deal FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
  CONSTRAINT axis_valid CHECK (
    axis IN (
      'ncads_source',
      'ebitda_addback_stack',
      'officer_comp',
      'affiliate_ownership',
      'living_expense'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_deal_methodology_choices_deal
  ON deal_methodology_choices(deal_id, bank_id);

ALTER TABLE deal_methodology_choices ENABLE ROW LEVEL SECURITY;

-- Service role bypass (used by supabaseAdmin())
CREATE POLICY "deal_methodology_choices_service_role"
  ON deal_methodology_choices
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated tenant scope (Phase 84A JWT-claims pattern;
-- matches deal_financial_facts policy from 20260418_phase_84_rls_tenant_wall_batch_a.sql)
CREATE POLICY "deal_methodology_choices_tenant_scope"
  ON deal_methodology_choices
  FOR ALL TO authenticated
  USING (
    bank_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'bank_id',
      ''
    )
  )
  WITH CHECK (
    bank_id::text = COALESCE(
      current_setting('request.jwt.claims', true)::jsonb->>'bank_id',
      ''
    )
  );
