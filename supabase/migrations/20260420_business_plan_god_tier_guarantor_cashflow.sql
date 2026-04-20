-- Phase BPG — Business Plan God Tier
-- Migration 2: per-deal per-guarantor personal cash flow for Global DSCR.
-- FK to deal_ownership_entities(id); UNIQUE(deal_id, entity_id).

CREATE TABLE IF NOT EXISTS buddy_guarantor_cashflow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES deal_ownership_entities(id),
  w2_salary numeric DEFAULT 0,
  other_personal_income numeric DEFAULT 0,
  personal_income_notes text,
  mortgage_payment numeric DEFAULT 0,
  auto_payments numeric DEFAULT 0,
  student_loans numeric DEFAULT 0,
  credit_card_minimums numeric DEFAULT 0,
  other_personal_debt numeric DEFAULT 0,
  personal_debt_notes text,
  source text DEFAULT 'manual',
  tax_year integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, entity_id)
);
