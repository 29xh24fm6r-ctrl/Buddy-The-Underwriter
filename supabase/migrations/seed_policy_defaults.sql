-- =====================================================================
-- SEED POLICY DEFAULTS
-- Example default values extracted from policy chunks
-- =====================================================================
-- REPLACE 'YOUR_BANK_ID_HERE' with actual bank_id from: select id, name from banks;
-- REPLACE chunk_id values with actual chunk IDs from: select id, asset_id from bank_policy_chunks limit 10;
-- =====================================================================

-- SBA 7(a) Defaults
INSERT INTO bank_policy_defaults (
  bank_id,
  deal_type,
  industry,
  field_name,
  field_label,
  field_type,
  default_value,
  chunk_id,
  confidence_score,
  source_text,
  min_value,
  max_value
) VALUES
  -- Interest Rate
  (
    'YOUR_BANK_ID_HERE',
    'sba_7a',
    NULL,
    'interest_rate',
    'Interest Rate',
    'text',
    '"Prime + 2.75%"',
    NULL,
    0.95,
    'Standard SBA 7(a) rate is Prime + 2.75% for loans under $50,000',
    NULL,
    NULL
  ),
  -- Guarantee Fee
  (
    'YOUR_BANK_ID_HERE',
    'sba_7a',
    NULL,
    'guarantee_fee',
    'SBA Guarantee Fee',
    'percentage',
    '2.0',
    NULL,
    1.0,
    'SBA guarantee fee is 2% for loans under $1,000,000',
    0.0,
    3.5
  ),
  -- Term (months)
  (
    'YOUR_BANK_ID_HERE',
    'sba_7a',
    NULL,
    'term_months',
    'Loan Term (Months)',
    'number',
    '120',
    NULL,
    0.90,
    'Standard term for SBA 7(a) working capital loans is 10 years (120 months)',
    12,
    300
  ),
  -- Down Payment
  (
    'YOUR_BANK_ID_HERE',
    'sba_7a',
    NULL,
    'down_payment_pct',
    'Borrower Down Payment (%)',
    'percentage',
    '10',
    NULL,
    1.0,
    'SBA 7(a) requires minimum 10% borrower equity injection',
    10,
    50
  );

-- SBA 504 Defaults
INSERT INTO bank_policy_defaults (
  bank_id,
  deal_type,
  industry,
  field_name,
  field_label,
  field_type,
  default_value,
  confidence_score,
  source_text
) VALUES
  (
    'YOUR_BANK_ID_HERE',
    'sba_504',
    NULL,
    'bank_loan_pct',
    'Bank Loan Portion (%)',
    'percentage',
    '50',
    1.0,
    'SBA 504 structure: 50% bank loan, 40% CDC loan, 10% borrower equity'
  ),
  (
    'YOUR_BANK_ID_HERE',
    'sba_504',
    NULL,
    'cdc_loan_pct',
    'CDC/SBA Loan Portion (%)',
    'percentage',
    '40',
    1.0,
    'SBA 504 structure: 50% bank loan, 40% CDC loan, 10% borrower equity'
  ),
  (
    'YOUR_BANK_ID_HERE',
    'sba_504',
    NULL,
    'borrower_equity_pct',
    'Borrower Equity (%)',
    'percentage',
    '10',
    1.0,
    'SBA 504 structure: 50% bank loan, 40% CDC loan, 10% borrower equity'
  );

-- Conventional CRE Defaults
INSERT INTO bank_policy_defaults (
  bank_id,
  deal_type,
  industry,
  field_name,
  field_label,
  field_type,
  default_value,
  confidence_score,
  source_text,
  min_value,
  max_value
) VALUES
  (
    'YOUR_BANK_ID_HERE',
    'conventional',
    'commercial_real_estate',
    'max_ltv',
    'Maximum LTV (%)',
    'percentage',
    '80',
    1.0,
    'Maximum LTV for CRE loans is 80% of appraised value',
    0,
    80
  ),
  (
    'YOUR_BANK_ID_HERE',
    'conventional',
    'commercial_real_estate',
    'interest_rate',
    'Interest Rate',
    'text',
    '"Prime + 2.50%"',
    0.85,
    'Conventional CRE loans typically priced at Prime + 2.50% to 3.00%',
    NULL,
    NULL
  ),
  (
    'YOUR_BANK_ID_HERE',
    'conventional',
    'commercial_real_estate',
    'amortization_months',
    'Amortization Period (Months)',
    'number',
    '300',
    0.90,
    'CRE loans amortized over 25 years with 5-7 year balloon',
    120,
    360
  );

-- Equipment Financing Defaults
INSERT INTO bank_policy_defaults (
  bank_id,
  deal_type,
  industry,
  field_name,
  field_label,
  field_type,
  default_value,
  confidence_score,
  source_text,
  min_value,
  max_value
) VALUES
  (
    'YOUR_BANK_ID_HERE',
    'equipment',
    NULL,
    'max_ltv',
    'Maximum Equipment LTV (%)',
    'percentage',
    '85',
    1.0,
    'Equipment financing maximum 85% LTV',
    0,
    85
  ),
  (
    'YOUR_BANK_ID_HERE',
    'equipment',
    NULL,
    'term_months',
    'Equipment Loan Term (Months)',
    'number',
    '84',
    0.95,
    'Maximum 7-year term for equipment financing',
    12,
    84
  ),
  (
    'YOUR_BANK_ID_HERE',
    'equipment',
    NULL,
    'interest_rate',
    'Interest Rate',
    'text',
    '"Prime + 3.00%"',
    0.80,
    'Equipment loans priced at Prime + 3.00%',
    NULL,
    NULL
  );

-- Term Loan Defaults
INSERT INTO bank_policy_defaults (
  bank_id,
  deal_type,
  industry,
  field_name,
  field_label,
  field_type,
  default_value,
  confidence_score,
  source_text,
  min_value,
  max_value
) VALUES
  (
    'YOUR_BANK_ID_HERE',
    'term_loan',
    NULL,
    'max_amount',
    'Maximum Loan Amount',
    'currency',
    '5000000',
    1.0,
    'Maximum loan amount: $5,000,000 without executive approval',
    0,
    5000000
  ),
  (
    'YOUR_BANK_ID_HERE',
    'term_loan',
    NULL,
    'min_fico',
    'Minimum FICO Score',
    'number',
    '660',
    1.0,
    'Minimum FICO score: 660 for all equipment loans',
    300,
    850
  ),
  (
    'YOUR_BANK_ID_HERE',
    'term_loan',
    NULL,
    'term_months',
    'Maximum Term (Months)',
    'number',
    '84',
    0.95,
    'Maximum term: 7 years for equipment',
    12,
    84
  );

-- Industry-specific: Restaurant defaults
INSERT INTO bank_policy_defaults (
  bank_id,
  deal_type,
  industry,
  field_name,
  field_label,
  field_type,
  default_value,
  confidence_score,
  source_text,
  min_value,
  max_value
) VALUES
  (
    'YOUR_BANK_ID_HERE',
    'sba_7a',
    'restaurant',
    'min_dscr',
    'Minimum DSCR',
    'number',
    '1.25',
    0.90,
    'Restaurant loans require higher DSCR due to industry risk',
    1.0,
    NULL
  ),
  (
    'YOUR_BANK_ID_HERE',
    'sba_7a',
    'restaurant',
    'max_loan_amount',
    'Maximum Loan Amount',
    'currency',
    '2500000',
    0.85,
    'Restaurant SBA 7(a) loans capped at $2.5M due to industry volatility',
    0,
    2500000
  );

-- =====================================================================
-- VERIFICATION
-- =====================================================================
-- Run these queries to verify the seed data:
-- 
-- -- Count defaults by deal type:
-- SELECT deal_type, COUNT(*) FROM bank_policy_defaults GROUP BY deal_type;
--
-- -- View all SBA 7(a) defaults:
-- SELECT field_label, default_value, source_text FROM bank_policy_defaults WHERE deal_type = 'sba_7a';
--
-- -- Find defaults with low confidence:
-- SELECT field_label, confidence_score, source_text FROM bank_policy_defaults WHERE confidence_score < 0.9;
