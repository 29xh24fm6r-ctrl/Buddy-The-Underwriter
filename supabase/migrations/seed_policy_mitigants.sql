-- =====================================================================
-- SEED POLICY MITIGANTS
-- Example mitigants for existing policy rules
-- =====================================================================
-- REPLACE 'YOUR_BANK_ID_HERE' with actual bank_id from: select id, name from banks;
-- =====================================================================

-- CRE Max LTV Rule Mitigants
UPDATE public.bank_policy_rules
SET mitigants = '[
  {"key":"reduce_loan_amount","label":"Reduce loan amount / increase equity","priority":1},
  {"key":"add_collateral","label":"Add additional collateral","priority":2},
  {"key":"increase_pricing","label":"Increase pricing / improve yield","priority":3},
  {"key":"stronger_guarantor","label":"Add/strengthen guarantor support","priority":1}
]'::JSONB,
exception_template = '{
  "title": "CRE LTV Exception Request",
  "justification_prompt": "Explain why LTV exceeds 80% policy maximum and how risk is mitigated",
  "approvals": ["Credit Admin", "CLO"]
}'::JSONB
WHERE bank_id = 'YOUR_BANK_ID_HERE'
  AND rule_key = 'cre.max_ltv';

-- SBA Min DSCR Rule Mitigants
UPDATE public.bank_policy_rules
SET mitigants = '[
  {"key":"increase_equity","label":"Increase borrower equity injection","priority":1},
  {"key":"reduce_debt","label":"Reduce loan amount / debt service","priority":1},
  {"key":"add_revenue_stream","label":"Document additional revenue streams","priority":2},
  {"key":"personal_guarantor","label":"Add personal guarantor with strong financials","priority":2},
  {"key":"sba_guarantee","label":"Leverage SBA guarantee to offset risk","priority":3}
]'::JSONB,
exception_template = '{
  "title": "SBA DSCR Exception Request",
  "justification_prompt": "Explain why DSCR is below 1.15x minimum and what compensating factors exist",
  "approvals": ["SBA Specialist", "Credit Admin"]
}'::JSONB
WHERE bank_id = 'YOUR_BANK_ID_HERE'
  AND rule_key = 'sba.min_dscr';

-- Term Loan Max Amount Rule Mitigants
UPDATE public.bank_policy_rules
SET mitigants = '[
  {"key":"executive_approval","label":"Escalate to executive committee for approval","priority":1},
  {"key":"syndicate_loan","label":"Syndicate loan to reduce concentration risk","priority":2},
  {"key":"split_facilities","label":"Split into multiple facilities","priority":3}
]'::JSONB,
exception_template = '{
  "title": "Loan Amount Exception Request",
  "justification_prompt": "Explain why loan exceeds $5M maximum and what additional due diligence will be performed",
  "approvals": ["Chief Lending Officer", "CEO"]
}'::JSONB
WHERE bank_id = 'YOUR_BANK_ID_HERE'
  AND rule_key = 'term_loan.max_amount';

-- Equipment Min FICO Rule Mitigants
UPDATE public.bank_policy_rules
SET mitigants = '[
  {"key":"increase_down_payment","label":"Increase down payment / reduce LTV","priority":1},
  {"key":"cross_collateral","label":"Add cross-collateralization with other assets","priority":2},
  {"key":"cosigner","label":"Add creditworthy co-signer","priority":1},
  {"key":"shorter_term","label":"Reduce loan term to improve cash flow coverage","priority":3}
]'::JSONB,
exception_template = '{
  "title": "Equipment FICO Exception Request",
  "justification_prompt": "Explain why FICO is below 660 minimum and what compensating credit factors exist",
  "approvals": ["Equipment Finance Manager", "Credit Admin"]
}'::JSONB
WHERE bank_id = 'YOUR_BANK_ID_HERE'
  AND rule_key = 'equipment.min_fico';

-- Owner-Occupied Cash Injection Rule Mitigants
UPDATE public.bank_policy_rules
SET mitigants = '[
  {"key":"seller_financing","label":"Document seller financing contribution","priority":1},
  {"key":"gift_funds","label":"Document gift funds from family/partners","priority":2},
  {"key":"reduce_purchase_price","label":"Renegotiate purchase price","priority":3},
  {"key":"sweat_equity","label":"Document sweat equity / value-add improvements","priority":2}
]'::JSONB,
exception_template = '{
  "title": "Owner-Occupied Equity Exception Request",
  "justification_prompt": "Explain why cash injection is below 10% minimum and how borrower demonstrates commitment",
  "approvals": ["CRE Manager", "Credit Admin"]
}'::JSONB
WHERE bank_id = 'YOUR_BANK_ID_HERE'
  AND rule_key = 'owner_occupied.min_cash_injection';

-- =====================================================================
-- VERIFICATION
-- =====================================================================
-- Run these queries to verify the mitigants:
-- 
-- -- View all rules with mitigants:
-- SELECT rule_key, title, severity, 
--        jsonb_array_length(mitigants) AS mitigant_count,
--        exception_template->>'title' AS exception_title
-- FROM bank_policy_rules 
-- WHERE bank_id = 'YOUR_BANK_ID_HERE'
--   AND jsonb_array_length(mitigants) > 0;
--
-- -- View mitigants for specific rule:
-- SELECT rule_key, jsonb_pretty(mitigants) 
-- FROM bank_policy_rules 
-- WHERE bank_id = 'YOUR_BANK_ID_HERE' 
--   AND rule_key = 'cre.max_ltv';
