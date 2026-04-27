-- SBA Policy Rules — SOP 50 10 8 refresh
-- Effective: SOP 50 10 8 (June 1, 2025) + Procedural Notices 5000-875701
-- (SBSS sunset, March 1, 2026) + 5000-876626 (citizenship/residency,
-- March 1, 2026).
--
-- This migration:
--   1. Adds policy_version / superseded_at / superseded_by_rule_id columns
--      (effective_date already exists in 20251227000012_sba_god_mode_foundation).
--   2. Stamps every existing rule (the 10 seeded under SOP 50 10 7(K)) as
--      superseded.
--   3. Inserts 22 SOP 50 10 8 rules.
--
-- The eligibility engine query in src/lib/sba/eligibility.ts must filter
-- `superseded_at IS NULL`. That change ships in the same PR as this
-- migration; without it the engine returns contradictory rules.

BEGIN;

-- ============================================================
-- 1. Add versioning columns
-- ============================================================

ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'SOP_50_10_7K',
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_rule_id uuid REFERENCES public.sba_policy_rules(id);

CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_active
  ON public.sba_policy_rules(program, policy_version)
  WHERE superseded_at IS NULL;

COMMENT ON COLUMN public.sba_policy_rules.policy_version IS
  'SOP version this rule belongs to (e.g., SOP_50_10_7K, SOP_50_10_8).';
COMMENT ON COLUMN public.sba_policy_rules.superseded_at IS
  'Timestamp at which this rule was superseded by a newer SOP/procedural notice. NULL = active.';
COMMENT ON COLUMN public.sba_policy_rules.superseded_by_rule_id IS
  'Optional pointer to the rule that replaces this one.';

-- ============================================================
-- 2. Supersede legacy SOP 50 10 7(K) rules
-- ============================================================
--
-- The 10 rules seeded under 20251227000014_seed_sba_rules.sql are
-- 50 10 7(K)-vintage. Stamp them all superseded so the eligibility query
-- returns only the new 50 10 8 rules.

UPDATE public.sba_policy_rules
   SET policy_version = 'SOP_50_10_7K',
       superseded_at  = NOW()
 WHERE superseded_at IS NULL
   AND policy_version = 'SOP_50_10_7K';

-- ============================================================
-- 3. Insert 22 SOP 50 10 8 rules
-- ============================================================
-- Pattern matches 20251227000014_seed_sba_rules.sql. policy_version
-- is 'SOP_50_10_8' for every rule. effective_date is '2025-06-01'
-- except for rules grounded in March 2026 procedural notices.

-- 1. Citizenship — 100% U.S. owners (Procedural Notice 5000-876626)
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'ELIGIBILITY.CITIZENSHIP_100_PCT', 'ELIGIBILITY',
  '{"field": "all_owners_citizenship_eligible", "eq": true}'::jsonb,
  '100% Eligible Ownership',
  'Procedural Notice 5000-876626 (effective March 1, 2026) requires every owner of any percentage to be a U.S. citizen, U.S. national, or Lawful Permanent Resident. Mixed ownership (e.g., a non-citizen owning even 1%) is not eligible.',
  'Every single owner of the business must be a U.S. citizen, national, or green-card holder. Even a 1% owner who is not eligible disqualifies the application.',
  '[
    {"issue": "One owner is not a U.S. citizen / LPR / national",
     "fix": "Restructure ownership so 100% of equity is held by eligible owners",
     "example": "Buy out the ineligible owner before applying"}
  ]'::jsonb,
  'Procedural Notice 5000-876626', 'HARD_STOP', 'SOP_50_10_8', '2026-03-01'
);

-- 2. Six-month ownership lookback
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'ELIGIBILITY.OWNERSHIP_LOOKBACK_6MO', 'ELIGIBILITY',
  '{"field": "ineligible_owner_in_lookback_window", "eq": false}'::jsonb,
  'No Ineligible Owner in 6-Month Lookback',
  'SOP 50 10 8 §A Ch.2 — no ineligible person may have held any ownership interest in the applicant during the six months preceding the application. Restructuring an owner out immediately before applying is not permitted.',
  'If anyone with the wrong status (non-citizen, prior SBA loss, etc.) was an owner in the last 6 months, the deal is not eligible — even if they no longer own anything today.',
  '[
    {"issue": "Ineligible owner left within last 6 months",
     "fix": "Wait until at least 6 months have passed since the ineligible owner exited",
     "example": "Owner exited Mar 2026 → eligible Sep 2026"}
  ]'::jsonb,
  'SOP 50 10 8 §A Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 3. CAIVRS clear
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'ELIGIBILITY.CAIVRS_CLEAR', 'ELIGIBILITY',
  '{"all": [
    {"field": "caivrs_checked", "eq": true},
    {"field": "caivrs_hits", "eq": 0}
  ]}'::jsonb,
  'CAIVRS Clear for All Principals',
  'SOP 50 10 8 §A Ch.2 + §B Ch.1 — CAIVRS must be checked for every principal and return zero delinquencies on federal debt. A hit is a hard stop until cleared.',
  'Every owner of 20%+ must be checked against CAIVRS (the federal delinquent-borrower database). Any unresolved hit blocks the loan.',
  '[
    {"issue": "CAIVRS hit on a principal",
     "fix": "Resolve the underlying federal debt and obtain a clearance letter before applying",
     "example": "Pay defaulted student loan; obtain Dept of Ed clearance"}
  ]'::jsonb,
  'SOP 50 10 8 §A Ch.2 + §B Ch.1', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 4. No prior SBA loss
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'ELIGIBILITY.NO_PRIOR_SBA_LOSS', 'ELIGIBILITY',
  '{"field": "borrower_has_prior_sba_loss", "eq": false}'::jsonb,
  'No Prior Loss to U.S. Government',
  'SOP 50 10 8 §A Ch.2 — borrowers and principals who have caused a loss to the U.S. government on a prior obligation are not eligible.',
  'If you, the business, or any 20%+ owner ever caused a loss on a federal loan or guarantee, the deal is not eligible.',
  '[
    {"issue": "Prior SBA charge-off in principal''s history",
     "fix": "Not waivable — restructure ownership to remove the affected principal, or pursue conventional financing",
     "example": "No SBA workaround available"}
  ]'::jsonb,
  'SOP 50 10 8 §A Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 5. No MCA refinance via SBA proceeds
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'USE_OF_PROCEEDS.NO_MCA_REFI', 'USE_OF_PROCEEDS',
  '{"field": "use_of_proceeds_includes_mca_refi", "eq": false}'::jsonb,
  'No Merchant Cash Advance Refinance',
  'SOP 50 10 8 §B Ch.1 — MCAs (merchant cash advances / factor-rate products) are not eligible for SBA refinance. Refinancing one is a hard stop.',
  'You cannot use SBA loan proceeds to pay off a merchant cash advance or any factor-rate "advance" product.',
  '[
    {"issue": "Use of proceeds includes MCA payoff",
     "fix": "Remove MCA from sources & uses; pay off MCA from another source first",
     "example": "Refinance MCA with seller-financed bridge, then SBA loan covers eligible uses"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.1', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 6. Working capital > 50% of proceeds → triggers (mitigation)
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'USE_OF_PROCEEDS.WC_50_PCT_TRIGGERS', 'USE_OF_PROCEEDS',
  '{"any": [
    {"field": "working_capital_pct_of_proceeds", "lte": 0.50},
    {"all": [
      {"field": "working_capital_justification_present", "eq": true},
      {"field": "lien_on_all_fixed_assets_planned", "eq": true}
    ]}
  ]}'::jsonb,
  'Working Capital Above 50% Triggers Justification + Lien',
  'SOP 50 10 8 §B Ch.1 + §B Ch.4 — when working capital exceeds 50% of total proceeds, the lender must document a written working-capital justification AND take a lien on all available fixed assets.',
  'If most of the loan is for working capital, the bank must explain why and put a lien on every business asset to back it up.',
  '[
    {"issue": "WC > 50% with no documented justification",
     "fix": "Document the working-capital projection, source, and timeline in credit memo",
     "example": "12-month forward AR/AP build-out projection signed by management"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.1 + §B Ch.4', 'REQUIRES_MITIGATION', 'SOP_50_10_8', '2025-06-01'
);

-- 7. Seller note used for equity — full standby + ≤50% of equity
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'EQUITY.SELLER_NOTE_STANDBY_AND_CAP', 'EQUITY',
  '{"any": [
    {"field": "seller_note_used_for_equity", "eq": false},
    {"all": [
      {"field": "seller_note_full_standby_for_loan_term", "eq": true},
      {"field": "seller_note_pct_of_equity", "lte": 0.50}
    ]}
  ]}'::jsonb,
  'Seller Note as Equity — Full Standby + 50% Cap',
  'SOP 50 10 8 §B Ch.2 — a seller note may count toward the equity injection only if it is on full standby for the entire SBA loan term and represents no more than 50% of the equity injection.',
  'You can have the seller carry part of your down payment, but only if (a) they don''t get paid until the SBA loan is fully repaid AND (b) it''s no more than half of your total equity.',
  '[
    {"issue": "Seller note > 50% of equity",
     "fix": "Increase cash equity OR reduce seller-note portion below 50%",
     "example": "Total equity $100K → max seller note = $50K"},
    {"issue": "Seller note not on full standby",
     "fix": "Re-paper the seller note with a full-standby agreement for the SBA loan term",
     "example": "10-year SBA loan → seller note silent for 10 years"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 8. Retaining seller — 2-year personal guarantee
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'COB.RETAINING_SELLER_2YR_GUARANTEE', 'COB',
  '{"any": [
    {"field": "retaining_seller_present", "eq": false},
    {"field": "retaining_seller_guarantees_2yr", "eq": true}
  ]}'::jsonb,
  'Retaining Seller Must Provide 2-Year Personal Guarantee',
  'SOP 50 10 8 §B Ch.2 — when the seller retains any ownership after the change-of-ownership transaction, the seller must personally guarantee the SBA loan for at least 2 years post-closing.',
  'If the seller is keeping any ownership in the business, they must personally guarantee the SBA loan for the first 2 years.',
  '[
    {"issue": "Seller retaining ownership but unwilling to guarantee",
     "fix": "Restructure as 100% buyout (no retention) OR seller must execute the 2-year guarantee",
     "example": "Buy 100% from seller; seller fully exits"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 9. COB single transaction
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'COB.SINGLE_TRANSACTION_REQUIRED', 'COB',
  '{"field": "cob_is_single_transaction", "eq": true}'::jsonb,
  'Change of Ownership Must Be Single Transaction',
  'SOP 50 10 8 §B Ch.2 — a change-of-ownership transaction financed by an SBA 7(a) loan must close as a single transaction. Phased / staggered acquisitions are not permitted.',
  'You can''t buy the business in pieces over time using the SBA loan. The whole purchase must close in one transaction.',
  '[
    {"issue": "COB structured as staged purchase",
     "fix": "Combine into a single closing transaction at one of the planned dates",
     "example": "Buy all remaining 60% at the closing of this loan rather than in 20% increments"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 10. Partial COB must be stock purchase
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'COB.PARTIAL_MUST_BE_STOCK', 'COB',
  '{"any": [
    {"field": "is_partial_cob", "eq": false},
    {"field": "cob_transaction_type", "eq": "stock"}
  ]}'::jsonb,
  'Partial COB Must Be a Stock Purchase',
  'SOP 50 10 8 §B Ch.2 — a partial change-of-ownership (less than 100% acquisition) must be structured as a stock purchase, not an asset purchase.',
  'If you''re buying part of the business (not all of it), it has to be a stock purchase, not an asset purchase.',
  '[
    {"issue": "Partial COB structured as asset purchase",
     "fix": "Re-structure as a stock purchase OR scope to a 100% acquisition",
     "example": "Buy 60% of S-corp stock instead of 60% of assets"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 11. Franchise — directory listed AND certified (or pre-deadline)
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'FRANCHISE.DIRECTORY_LISTED_AND_CERTIFIED', 'ELIGIBILITY',
  '{"any": [
    {"field": "is_franchise_deal", "eq": false},
    {"all": [
      {"field": "franchise_brand_on_directory", "eq": true},
      {"field": "franchise_brand_certified_or_pre_deadline", "eq": true}
    ]}
  ]}'::jsonb,
  'Franchise Brand on SBA Directory + Certified',
  'SOP 50 10 8 §A Ch.2 + Procedural Notice 5000-871010 — for franchise deals the brand must be on the SBA Franchise Directory AND must be SBA-certified (or, for brands listed as of May 2023, may operate under the certification grace period until June 30, 2026).',
  'Your franchise brand must be on the SBA approved-list AND have completed the SBA certification — unless they''re a pre-existing listed brand still inside the certification deadline.',
  '[
    {"issue": "Franchise brand not on SBA Directory",
     "fix": "Brand must apply to SBA Directory; not eligible until listed",
     "example": "Franchisor must initiate Directory application"},
    {"issue": "Brand listed but past certification deadline without certification",
     "fix": "Wait for franchisor certification OR consider non-SBA financing",
     "example": "Brand listed pre-May 2023 but missed June 2026 deadline"}
  ]'::jsonb,
  'SOP 50 10 8 §A Ch.2 + PN 5000-871010', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 12. Hazard insurance for loans > $50K
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'INSURANCE.HAZARD_REQUIRED', 'INSURANCE',
  '{"any": [
    {"field": "loan_amount", "lte": 50000},
    {"field": "hazard_insurance_replacement_cost_present", "eq": true}
  ]}'::jsonb,
  'Hazard Insurance at Replacement Cost',
  'SOP 50 10 8 §B Ch.4 — for loans over $50,000 secured by tangible property, hazard insurance at replacement cost must be in place at closing.',
  'For most SBA loans you must carry hazard insurance on the business assets at full replacement cost.',
  '[
    {"issue": "Hazard insurance not yet documented",
     "fix": "Bind a policy at replacement cost prior to closing; lender named as loss payee",
     "example": "Property + equipment policy with bank as additional insured"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.4', 'REQUIRES_MITIGATION', 'SOP_50_10_8', '2025-06-01'
);

-- 13. Life insurance — conditional
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'INSURANCE.LIFE_REQUIRED_CONDITIONAL', 'INSURANCE',
  '{"any": [
    {"field": "is_single_owner_business", "eq": false},
    {"field": "loan_fully_secured_by_hard_collateral", "eq": true},
    {"field": "key_person_life_insurance_present", "eq": true}
  ]}'::jsonb,
  'Key-Person Life Insurance When Single-Owner + Under-Collateralized',
  'SOP 50 10 8 §B Ch.4 — life insurance on the key person is required when the business is single-owner and the loan is not fully secured by hard collateral.',
  'If the business depends on one person and the loan isn''t fully secured by collateral, you must carry life insurance on that person.',
  '[
    {"issue": "Single-owner deal under-collateralized without life insurance",
     "fix": "Bind term life insurance on the key person, lender as collateral assignee, before closing",
     "example": "Term policy face amount ≥ loan amount, 10-year term"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.4', 'REQUIRES_MITIGATION', 'SOP_50_10_8', '2025-06-01'
);

-- 14. Tax transcript / 4506-C verification
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'DOCS.TAX_TRANSCRIPT_VERIFICATION', 'DOCUMENTATION',
  '{"all": [
    {"field": "form_4506c_signed", "eq": true},
    {"field": "tax_transcripts_received_or_pending", "eq": true}
  ]}'::jsonb,
  'IRS Form 4506-C Signed and Transcripts Requested',
  'SOP 50 10 8 §A Ch.5 + §B Ch.1 — borrower must sign IRS Form 4506-C and the lender must request tax transcripts. Mismatches between filed returns and reported financials must be reconciled before closing.',
  'You must sign IRS Form 4506-C so the bank can pull your tax transcripts. They''ll match the transcripts to the returns you provided.',
  '[
    {"issue": "4506-C not yet signed",
     "fix": "Sign 4506-C as part of the SBA package e-sign ceremony",
     "example": "Captured at the same DocuSeal envelope as Form 1919"}
  ]'::jsonb,
  'SOP 50 10 8 §A Ch.5 + §B Ch.1', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 15. SBSS sunset — federally regulated lenders
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'SCREENING.SBSS_NOT_USED_BY_FEDERAL_LENDERS', 'SCREENING',
  '{"any": [
    {"field": "lender_is_federally_regulated", "eq": false},
    {"field": "screening_uses_sbss", "eq": false}
  ]}'::jsonb,
  'SBSS Not Permitted for Federally-Regulated Lenders',
  'Procedural Notice 5000-875701 (effective March 1, 2026) — federally-regulated lenders may no longer use SBSS as the screening tool for 7(a) Small Loans. Lender must rely on credit memo + tradeline review.',
  'If your bank is federally regulated, it can''t use the SBSS score to screen SBA Small Loans anymore. The credit decision is based on tradelines and the credit memo.',
  '[
    {"issue": "Lender configured to use SBSS as primary screen",
     "fix": "Switch screening pipeline to tradeline + credit-memo evaluation",
     "example": "Disable SBSS gate in lender admin; rely on policy engine output"}
  ]'::jsonb,
  'Procedural Notice 5000-875701', 'HARD_STOP', 'SOP_50_10_8', '2026-03-01'
);

-- 16. Program-aware DSCR
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'FINANCIAL.DSCR_PROGRAM_AWARE', 'FINANCIAL',
  '{"any": [
    {"all": [
      {"field": "is_7a_small_loan", "eq": true},
      {"field": "dscr", "gte": 1.10}
    ]},
    {"all": [
      {"field": "is_acquisition", "eq": true},
      {"field": "dscr", "gte": 1.20}
    ]},
    {"all": [
      {"field": "is_7a_small_loan", "eq": false},
      {"field": "is_acquisition", "eq": false},
      {"field": "dscr", "gte": 1.15}
    ]}
  ]}'::jsonb,
  'DSCR Meets Program-Specific Minimum',
  'SOP 50 10 8 §B Ch.1 — DSCR thresholds vary by program: ≥1.10 for 7(a) Small Loans, ≥1.20 for acquisitions, ≥1.15 otherwise.',
  'How much cushion you need on debt service depends on the program — Small Loans need 1.10x, acquisitions 1.20x, regular 7(a) 1.15x.',
  '[
    {"issue": "DSCR below program threshold",
     "fix": "Lengthen amortization OR reduce loan amount OR raise EBITDA forecast",
     "example": "10-year → 25-year amortization on real-estate-secured deal"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.1', 'REQUIRES_MITIGATION', 'SOP_50_10_8', '2025-06-01'
);

-- 17. 10% equity injection — startups + COBs
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'FINANCIAL.EQUITY_INJECTION_10_PCT', 'FINANCIAL',
  '{"field": "equity_injection_pct_of_project", "gte": 0.10}'::jsonb,
  '10% Equity Injection of Total Project',
  'SOP 50 10 8 §B Ch.2 — equity injection of at least 10% of total project cost is required for both startups and complete changes of ownership. Pre-2021 distinction (20% startups vs 10% existing) eliminated.',
  'Both startups and acquisitions need at least 10% equity into the deal. The old 20% startup rule is gone.',
  '[
    {"issue": "Equity below 10%",
     "fix": "Increase cash injection OR add seller-note (≤50% of equity, full standby)",
     "example": "Project $1M → $100K equity needed; raise gap from cash or 401k rollover"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.2', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 18. Advisory — business age 2 years
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'ADVISORY.BUSINESS_AGE_2YR', 'ELIGIBILITY',
  '{"field": "business_age_years", "gte": 2}'::jsonb,
  'Advisory: 2 Years in Business Preferred',
  'SOP 50 10 8 §B Ch.1 — 7(a) loans generally underwrite better when the business has at least 2 years of operating history. Younger businesses are eligible but require stronger projections, mitigants, and collateral.',
  'You can apply with under 2 years in business, but expect more scrutiny on projections and collateral.',
  '[
    {"issue": "Business under 2 years old",
     "fix": "Document strong industry experience of ownership and provide 24-month projections",
     "example": "Owner has 8 years as GM in same industry; full P&L projection set"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.1', 'ADVISORY', 'SOP_50_10_8', '2025-06-01'
);

-- 19. 7(a) Small Loan max $350K
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'PROGRAM.SMALL_LOAN_MAX_350K', 'PROGRAM',
  '{"any": [
    {"field": "is_7a_small_loan", "eq": false},
    {"field": "loan_amount", "lte": 350000}
  ]}'::jsonb,
  '7(a) Small Loan Maximum $350,000',
  'SOP 50 10 8 §B Ch.1 — the 7(a) Small Loan program is capped at $350,000. Above that the deal must be evaluated under Standard 7(a).',
  'The Small Loan program tops out at $350K. Larger deals go through Standard 7(a) processing.',
  '[
    {"issue": "Loan over $350K labeled as Small Loan",
     "fix": "Reclassify as Standard 7(a)",
     "example": "Update product type so credit memo evaluates against Standard 7(a) thresholds"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.1', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 20. Personal real-estate collateral 25%-equity test
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'COLLATERAL.PERSONAL_RE_25PCT_EQUITY', 'COLLATERAL',
  '{"any": [
    {"field": "loan_amount", "lte": 350000},
    {"field": "loan_fully_secured_by_business_assets", "eq": true},
    {"field": "personal_re_collateral_decision_documented", "eq": true}
  ]}'::jsonb,
  'Personal Real Estate Collateral Decision Documented',
  'SOP 50 10 8 §B Ch.4 — for loans over $350,000 not fully secured by business assets, the lender must take a lien on principal-owned residential real estate that has at least 25% equity, OR document why the collateral was not taken.',
  'For larger loans, if business assets don''t fully cover the loan and an owner has a home with ≥25% equity, the bank usually has to put a lien on it — or document why not.',
  '[
    {"issue": "PRE collateral candidate exists but not pledged or documented",
     "fix": "Pledge the residence OR document the decision (e.g., not principal residence) in the credit memo",
     "example": "Memo: ''Owner''s residence has 35% equity but is in spouse''s name only; not pledged.''"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.4', 'REQUIRES_MITIGATION', 'SOP_50_10_8', '2025-06-01'
);

-- 21. Sources & Uses balanced (within $1)
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  'BOTH', 'FINANCIAL.SOURCES_USES_BALANCED', 'FINANCIAL',
  '{"field": "sources_uses_imbalance_abs", "lte": 1}'::jsonb,
  'Sources & Uses Tied Out',
  'SOP 50 10 8 §B Ch.1 — total sources must equal total uses (within rounding) before package is acceptable. Imbalance signals incomplete deal data or mis-classified line items.',
  'Every dollar coming into the deal has to match a dollar going out. The two columns must balance.',
  '[
    {"issue": "Sources do not equal uses",
     "fix": "Reconcile by adding the missing source or removing the over-stated use",
     "example": "Add closing-cost line item or correct loan amount"}
  ]'::jsonb,
  'SOP 50 10 8 §B Ch.1', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

-- 22. Credit elsewhere test — documented
INSERT INTO public.sba_policy_rules (
  program, rule_key, category, condition_json,
  title, explanation, borrower_friendly_explanation, fix_suggestions,
  sop_reference, severity, policy_version, effective_date
) VALUES (
  '7A', 'ELIGIBILITY.CREDIT_ELSEWHERE_50108', 'ELIGIBILITY',
  '{"all": [
    {"field": "credit_elsewhere_test_documented", "eq": true},
    {"field": "credit_elsewhere_finding", "in": ["unavailable", "available_but_unfavorable_terms"]}
  ]}'::jsonb,
  'Credit Elsewhere Test Documented',
  'SOP 50 10 8 §A Ch.5 — the lender must document a credit-elsewhere finding showing that the borrower cannot obtain credit on reasonable terms from non-Federal sources. The finding must be a specific, documented determination.',
  'The bank must explain in writing why you can''t get a regular (non-SBA) loan with reasonable terms. A blanket statement is not enough.',
  '[
    {"issue": "Credit elsewhere finding not documented",
     "fix": "Lender drafts the credit-elsewhere finding citing specific reasons (LTV cap, term, cash-flow gap)",
     "example": "Memo: ''Conventional max LTV 70% on real estate; this deal at 90% LTV is not available without SBA enhancement.''"}
  ]'::jsonb,
  'SOP 50 10 8 §A Ch.5', 'HARD_STOP', 'SOP_50_10_8', '2025-06-01'
);

COMMIT;
