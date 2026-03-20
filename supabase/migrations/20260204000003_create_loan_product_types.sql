-- 20260204_create_loan_product_types.sql
-- Reference table for loan product types with category grouping.

CREATE TABLE IF NOT EXISTS public.loan_product_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  requires_collateral boolean DEFAULT false,
  requires_real_estate boolean DEFAULT false,
  requires_sba_fields boolean DEFAULT false,
  display_order integer DEFAULT 100,
  enabled boolean DEFAULT true,
  config_json jsonb DEFAULT '{}'
);

-- Seed data (idempotent)
INSERT INTO public.loan_product_types (code, label, category, requires_real_estate, requires_sba_fields, display_order) VALUES
  -- Real Estate
  ('CRE_PURCHASE', 'Commercial Real Estate - Purchase', 'REAL_ESTATE', true, false, 10),
  ('CRE_REFI', 'Commercial Real Estate - Refinance', 'REAL_ESTATE', true, false, 11),
  ('CRE_CASH_OUT', 'Commercial Real Estate - Cash Out Refinance', 'REAL_ESTATE', true, false, 12),
  ('CRE_TERM', 'Commercial Real Estate - Term', 'REAL_ESTATE', true, false, 13),
  ('CONSTRUCTION', 'Construction Loan', 'REAL_ESTATE', true, false, 20),
  ('LAND', 'Land Acquisition', 'REAL_ESTATE', true, false, 21),
  ('BRIDGE', 'Bridge Loan', 'REAL_ESTATE', true, false, 22),
  -- Lines of Credit
  ('LOC_SECURED', 'Secured Line of Credit', 'LINES_OF_CREDIT', false, false, 30),
  ('LOC_UNSECURED', 'Unsecured Line of Credit', 'LINES_OF_CREDIT', false, false, 31),
  ('LOC_RE_SECURED', 'Real Estate Secured Line of Credit', 'LINES_OF_CREDIT', true, false, 32),
  ('LINE_OF_CREDIT', 'Line of Credit (General)', 'LINES_OF_CREDIT', false, false, 33),
  -- Term Loans
  ('TERM_SECURED', 'Secured Term Loan', 'TERM_LOANS', false, false, 40),
  ('TERM_UNSECURED', 'Unsecured Term Loan', 'TERM_LOANS', false, false, 41),
  ('C_AND_I_TERM', 'C&I Term Loan', 'TERM_LOANS', false, false, 42),
  ('EQUIPMENT', 'Equipment Financing', 'TERM_LOANS', false, false, 43),
  ('VEHICLE', 'Vehicle/Fleet Financing', 'TERM_LOANS', false, false, 44),
  ('WORKING_CAPITAL', 'Working Capital Loan', 'TERM_LOANS', false, false, 45),
  ('REFINANCE', 'Refinance', 'TERM_LOANS', false, false, 46),
  -- SBA
  ('SBA_7A', 'SBA 7(a)', 'SBA', false, true, 50),
  ('SBA_7A_STANDARD', 'SBA 7(a) Standard', 'SBA', false, true, 51),
  ('SBA_7A_SMALL', 'SBA 7(a) Small Loan', 'SBA', false, true, 52),
  ('SBA_504', 'SBA 504', 'SBA', true, true, 53),
  ('SBA_EXPRESS', 'SBA Express', 'SBA', false, true, 54),
  ('SBA_CAPLines', 'SBA CAPLines', 'SBA', false, true, 55),
  -- Specialty
  ('ACQUISITION', 'Business Acquisition', 'SPECIALTY', false, false, 60),
  ('FRANCHISE', 'Franchise Financing', 'SPECIALTY', false, false, 61),
  ('ACCOUNTS_RECEIVABLE', 'Accounts Receivable Financing', 'SPECIALTY', false, false, 62),
  ('INVENTORY', 'Inventory Financing', 'SPECIALTY', false, false, 63),
  ('OTHER', 'Other Commercial Loan', 'SPECIALTY', false, false, 99)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  requires_real_estate = EXCLUDED.requires_real_estate,
  requires_sba_fields = EXCLUDED.requires_sba_fields,
  display_order = EXCLUDED.display_order;
