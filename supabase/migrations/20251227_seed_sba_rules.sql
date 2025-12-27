-- Seed Initial SBA Policy Rules
-- Core 7(a) eligibility rules based on SOP 50 10 7(K)

-- ============================================================
-- 1. Business Age / Time in Business
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  '7A',
  'ELIGIBILITY.BUSINESS_AGE',
  'ELIGIBILITY',
  '{
    "field": "business_age_years",
    "gte": 2
  }'::jsonb,
  'Minimum 2 Years in Business',
  'SBA 7(a) loans generally require the business to have been operating for at least 2 years. Startups may qualify under special programs.',
  'Your business needs to have been operating for at least 2 years. If you''re newer, you may qualify for SBA Express or microloan programs.',
  '[
    {
      "issue": "Business less than 2 years old",
      "fix": "Wait until business reaches 2 years OR apply for SBA Express (lower loan amounts)",
      "example": "Founded in Jan 2023 → eligible in Jan 2025"
    },
    {
      "issue": "Business less than 2 years old",
      "fix": "Demonstrate strong industry experience of ownership (5+ years)",
      "example": "Owner was manager at similar company for 8 years"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 2.3.1',
  'REQUIRES_MITIGATION'
);

-- ============================================================
-- 2. Use of Proceeds - Prohibited Uses
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  'BOTH',
  'ELIGIBILITY.PROHIBITED_USE_GAMBLING',
  'USE_OF_PROCEEDS',
  '{
    "field": "use_of_proceeds_category",
    "not_in": ["gambling", "lending", "speculation", "passive_real_estate"]
  }'::jsonb,
  'Prohibited Use of Proceeds',
  'SBA loans cannot be used for gambling, lending activities, speculation, or passive real estate investment.',
  'SBA loans can''t fund casinos, payday lending, stock trading, or real estate held purely for resale. The business must actively operate.',
  '[
    {
      "issue": "Passive real estate investment",
      "fix": "Convert to owner-occupied property (51%+ occupancy by borrower)",
      "example": "Buy building, occupy 60% for your business, lease 40% to tenants"
    },
    {
      "issue": "Business involves gambling",
      "fix": "Gambling revenue must be <33% of total revenue to qualify",
      "example": "Restaurant with slot machines: ensure food/bev is 70%+ of revenue"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 2.2.1',
  'HARD_STOP'
);

-- ============================================================
-- 3. Debt Service Coverage Ratio (DSCR)
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  'BOTH',
  'FINANCIAL.DSCR_MINIMUM',
  'FINANCIAL',
  '{
    "field": "dscr",
    "gte": 1.15
  }'::jsonb,
  'Minimum Debt Service Coverage Ratio (DSCR) 1.15x',
  'The business must generate enough cash flow to cover all debt payments with at least 15% cushion. DSCR = Cash Flow / Total Debt Payments.',
  'Your business needs to make at least $1.15 for every $1.00 in loan payments. This shows you can comfortably afford the loan.',
  '[
    {
      "issue": "DSCR below 1.15",
      "fix": "Increase revenue or reduce existing debt before applying",
      "example": "Pay off equipment loan to reduce monthly payments"
    },
    {
      "issue": "DSCR below 1.15",
      "fix": "Request longer loan term to reduce monthly payment",
      "example": "10-year loan → 20-year loan cuts payment by ~40%"
    },
    {
      "issue": "DSCR below 1.15",
      "fix": "Demonstrate improving trend (1.05 → 1.10 → 1.15 over 3 years)",
      "example": "Show cash flow growth makes 1.15 achievable post-loan"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 4.2.2',
  'REQUIRES_MITIGATION'
);

-- ============================================================
-- 4. SBA Size Standards (Employee/Revenue based)
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  'BOTH',
  'ELIGIBILITY.SIZE_STANDARD_EMPLOYEES',
  'ELIGIBILITY',
  '{
    "field": "employee_count",
    "lte": 500
  }'::jsonb,
  'SBA Size Standard - Employees',
  'Most industries require fewer than 500 employees. Specific NAICS codes have different thresholds (check SBA size standards table).',
  'Your business must be "small" by SBA standards. Most industries allow up to 500 employees, but some (like manufacturing) allow more.',
  '[
    {
      "issue": "Employee count exceeds threshold",
      "fix": "Exclude part-time/seasonal workers if not year-round",
      "example": "50 full-time + 60 seasonal = 50 for SBA purposes"
    },
    {
      "issue": "Employee count exceeds threshold",
      "fix": "Check if business qualifies under revenue standard instead",
      "example": "Restaurant with 600 employees but <$10M revenue may still qualify"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 2.1.1',
  'HARD_STOP'
);

-- ============================================================
-- 5. Owner Equity Injection
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  'BOTH',
  'FINANCIAL.EQUITY_INJECTION_MINIMUM',
  'FINANCIAL',
  '{
    "field": "owner_equity_percentage",
    "gte": 10
  }'::jsonb,
  'Minimum 10% Owner Equity Injection',
  'Borrower must contribute at least 10% of total project cost in cash equity (not borrowed funds). Shows skin in the game.',
  'You must put in at least 10% of your own cash. For a $500K loan on a $550K project, you need $55K equity (10%).',
  '[
    {
      "issue": "Insufficient equity",
      "fix": "Reduce loan amount to lower equity requirement",
      "example": "$500K loan → $400K loan reduces equity need from $55K to $44K"
    },
    {
      "issue": "Insufficient equity",
      "fix": "Contribute equipment/inventory as equity (must be appraised)",
      "example": "Contribute $30K in equipment you already own"
    },
    {
      "issue": "Insufficient equity",
      "fix": "Bring in equity partner who contributes cash",
      "example": "Partner invests $50K for 20% ownership"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 4.1.3',
  'REQUIRES_MITIGATION'
);

-- ============================================================
-- 6. Personal Guarantee Requirement (20% Ownership)
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  'BOTH',
  'GUARANTEES.OWNER_20_PERCENT',
  'GUARANTEES',
  '{
    "all": [
      {"field": "owner_percentage", "gte": 20},
      {"field": "has_personal_guarantee", "eq": true}
    ]
  }'::jsonb,
  'Personal Guarantee Required for 20%+ Owners',
  'All owners with 20% or more equity must provide personal guarantees. No exceptions.',
  'If you own 20% or more of the business, you must personally guarantee the loan. This means your personal assets are at risk if the business defaults.',
  '[
    {
      "issue": "Owner refuses personal guarantee",
      "fix": "Reduce ownership below 20% to avoid guarantee requirement",
      "example": "Transfer 1% to spouse/partner to drop to 19.5%"
    },
    {
      "issue": "Owner refuses personal guarantee",
      "fix": "SBA will not waive this - guarantee is mandatory",
      "example": "No workaround available"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 4.4.1',
  'HARD_STOP'
);

-- ============================================================
-- 7. Credit Elsewhere Test
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  '7A',
  'ELIGIBILITY.CREDIT_ELSEWHERE',
  'ELIGIBILITY',
  '{
    "field": "can_obtain_credit_elsewhere",
    "eq": false
  }'::jsonb,
  'Credit Elsewhere Test',
  'SBA loans are for businesses that cannot obtain reasonable credit through conventional financing. If you can get a regular bank loan on reasonable terms, you must use that instead.',
  'SBA loans are for businesses that banks won''t lend to conventionally. If you can get a normal bank loan with similar terms, you should use that.',
  '[
    {
      "issue": "Business has strong credit and can get conventional loan",
      "fix": "Accept conventional loan terms instead of SBA",
      "example": "Bank offers 7% conventional vs 8% SBA → take conventional"
    },
    {
      "issue": "Business has strong credit but needs higher LTV",
      "fix": "Demonstrate conventional loan requires >85% LTV which is unavailable",
      "example": "Need 90% financing on real estate → justifies SBA"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 2.1.3',
  'ADVISORY'
);

-- ============================================================
-- 8. Collateral Requirement
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  'BOTH',
  'COLLATERAL.AVAILABLE_ASSETS',
  'COLLATERAL',
  '{
    "field": "has_available_collateral",
    "eq": true
  }'::jsonb,
  'Collateral Required to Extent Available',
  'SBA requires lenders to secure loans to the extent collateral is available, but cannot decline a loan solely due to lack of collateral.',
  'You must pledge any business assets you have (equipment, real estate, inventory). If you don''t have enough, the loan can still be approved.',
  '[
    {
      "issue": "Insufficient collateral coverage",
      "fix": "Pledge all available business assets (equipment, receivables, inventory)",
      "example": "Blanket lien on all business assets even if value < loan amount"
    },
    {
      "issue": "Insufficient collateral coverage",
      "fix": "Pledge personal real estate if available",
      "example": "Second lien on primary residence to improve coverage"
    },
    {
      "issue": "No collateral available",
      "fix": "Demonstrate strong cash flow compensates for lack of collateral",
      "example": "DSCR of 1.50 justifies unsecured/under-secured loan"
    }
  ]'::jsonb,
  'SOP 50 10 7(K) Section 4.3.1',
  'ADVISORY'
);

-- ============================================================
-- 9. SBA 504 Specific: Job Creation
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  '504',
  'ELIGIBILITY_504.JOB_CREATION',
  'ELIGIBILITY',
  '{
    "any": [
      {"field": "creates_or_retains_jobs", "eq": true},
      {"field": "meets_public_policy_goal", "eq": true}
    ]
  }'::jsonb,
  'SBA 504: Job Creation or Public Policy Goal',
  'SBA 504 loans require the project to create/retain jobs (1 job per $75K CDC financing) OR meet a public policy goal (exports, energy efficiency, etc.).',
  'Your 504 loan must either create jobs (roughly 1 job per $75K borrowed from CDC) or help achieve a goal like exporting or going green.',
  '[
    {
      "issue": "Project does not create jobs",
      "fix": "Demonstrate job retention (prevent layoffs)",
      "example": "Buying building prevents relocation that would have eliminated 5 jobs"
    },
    {
      "issue": "Project does not create jobs",
      "fix": "Show public policy goal: energy efficiency improvements",
      "example": "New equipment reduces energy use by 25%"
    },
    {
      "issue": "Project does not create jobs",
      "fix": "Show public policy goal: export-related business",
      "example": "Expansion to manufacture goods sold internationally"
    }
  ]'::jsonb,
  'SOP 50 10 5(D) Section 2.1',
  'REQUIRES_MITIGATION'
);

-- ============================================================
-- 10. SBA 504 Specific: Owner-Occupied Real Estate
-- ============================================================

INSERT INTO public.sba_policy_rules (
  program, rule_key, category,
  condition_json,
  title, explanation, borrower_friendly_explanation,
  fix_suggestions,
  sop_reference, severity
) VALUES (
  '504',
  'ELIGIBILITY_504.OWNER_OCCUPANCY',
  'ELIGIBILITY',
  '{
    "field": "owner_occupancy_percentage",
    "gte": 51
  }'::jsonb,
  'SBA 504: Minimum 51% Owner-Occupancy',
  '504 loans for real estate require the borrower to occupy at least 51% of the building (can lease up to 49% to tenants).',
  'You must use at least 51% of the building for your own business. You can rent out the rest to tenants.',
  '[
    {
      "issue": "Occupancy below 51%",
      "fix": "Expand business operations to occupy more space",
      "example": "Move warehouse to building to increase occupancy to 60%"
    },
    {
      "issue": "Occupancy below 51%",
      "fix": "Lease space to related entity that qualifies as owner-occupancy",
      "example": "Sister company under same ownership occupies space → counts as owner-occupied"
    },
    {
      "issue": "Occupancy below 51%",
      "fix": "Consider 7(a) loan instead (allows lower owner-occupancy)",
      "example": "7(a) permits >20% rental income vs 504 cap of 49%"
    }
  ]'::jsonb,
  'SOP 50 10 5(D) Section 2.2.3',
  'HARD_STOP'
);
