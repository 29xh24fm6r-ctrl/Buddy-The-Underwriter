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

CREATE INDEX idx_deal_methodology_choices_deal
  ON deal_methodology_choices(deal_id, bank_id);

ALTER TABLE deal_methodology_choices ENABLE ROW LEVEL SECURITY;

-- RLS: tenant-scoped read/write (same shape as deal_financial_facts)
CREATE POLICY "Users can read methodology choices for their bank's deals"
  ON deal_methodology_choices
  FOR SELECT
  USING (
    bank_id IN (
      SELECT bank_id FROM bank_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can write methodology choices for their bank's deals"
  ON deal_methodology_choices
  FOR ALL
  USING (
    bank_id IN (
      SELECT bank_id FROM bank_members
      WHERE user_id = auth.uid()
    )
  );
