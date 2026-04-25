# SPEC S2 — Form Generators + Plaid + Deal Data Builder

**Date:** 2026-04-25 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 1.5–2 weeks · **Risk:** Medium (form fielding is detail-heavy; Plaid OAuth scoping)

**Depends on:** S1 (new rule keys reference deal-data fields built here) · **Blocks:** S3, S4

---

## Background

Three pieces ship together this sprint because they're tightly coupled:

1. **Forms 1919 + 413 — full SBA fidelity.** Today `src/lib/sba/forms/build1919.ts` is 19 lines and 5 fields. Real Form 1919 has three sections (Section I applicant, Section II per-individual, Section III per-entity) with ~80 fields total. Form 413 (PFS) has ~50 fields per signer including spouse signature and 90-day staleness. These two cover ~80% of borrower-facing form work; the remaining forms (1920, 912, 4506-C, 155, 159) ship in S4.

2. **Real Plaid integration.** `src/lib/integrations/plaid.ts` is a 3-line stub returning hardcoded fake data (`{accounts: 3, avg_balance: 185000, nsf_events: 0}`). Replace with real OAuth + transaction sync + classifier. Foundation for S4 (soft-pull credit, equity-injection seasoning verification).

3. **Deal data builder service.** S1 added 22 SOP 50 10 8 rules referencing fields like `is_7a_small_loan`, `equity_injection_pct_of_project`, `working_capital_pct_of_proceeds`, `franchise_brand_certified_or_pre_deadline`. The eligibility engine looks these up from a `dealData` parameter. Without a builder service that derives them from canonical state, every new rule evaluates against `undefined` and fails closed.

## Build principles captured

**#14 — SBA forms are contract surface; missing fields = gaps not defaults.** Form generators do not invent placeholder values. A missing required field flows to `deal_gap_queue` for borrower input via the existing Story tab + Borrower Voice path.

**#15 — Plaid soft data only.** Bank balances, transactions, statements. No credit-bureau data here (S4). The classifier labels MCAs, payroll, rent, recurring payments — drives debt-schedule auto-build and equity seasoning.

**#16 — Eligibility engine field lookups must default safely.** When a derived field is null (data not yet collected), the rule fails closed and surfaces in `deal_gap_queue` rather than passing silently.

---

## Pre-implementation verification (PIV)

### PIV-1 — S1 rules are live
```sql
SELECT count(*) FROM sba_policy_rules
WHERE policy_version='SOP_50_10_8' AND superseded_at IS NULL;
-- Expected: 22 (S1 must be merged first)
```

### PIV-2 — Confirm `deal_loan_requests` columns
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='deal_loan_requests'
  AND column_name IN ('seller_note_equity_portion','seller_note_full_standby',
    'working_capital_justification','lien_on_all_fixed_assets','franchise_brand_id',
    'equity_injection_amount','total_project_cost','use_of_proceeds');
```
**If any column is missing, this spec adds an additive migration `20260429_a_deal_loan_requests_sba_50108_columns.sql` to add them.** Likely missing: `seller_note_equity_portion`, `seller_note_full_standby`, `working_capital_justification`, `lien_on_all_fixed_assets`, `franchise_brand_id`. Verify before drafting migration content.

### PIV-3 — Confirm `ownership_entities` schema
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='ownership_entities';
```
Per roadmap: `id, deal_id, entity_type, display_name, tax_id_last4, meta_json, confidence, evidence_json, created_at, ownership_pct, title`. Citizenship status likely lives in `evidence_json` today. Spec adds a top-level column `citizenship_status text` for fast lookup.

### PIV-4 — Confirm Plaid stub present
```sh
grep -n "avg_balance: 185000" src/lib/integrations/plaid.ts
```
Expected: 1 match. If 0, the stub was already replaced — surface before proceeding.

### PIV-5 — Confirm `financial_snapshots_v1` table shape
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='financial_snapshots_v1';
```
Confirm it has `dscr_value` or similar. Adapt `dealDataBuilder.ts` field reference accordingly.

### PIV-6 — Confirm SBA Form 1919 + 413 PDFs available
The render layer requires the official PDF templates. Source: sba.gov. Commit to `public/sba-templates/`:
- `form-1919-rev-2025-06.pdf`
- `form-413-rev-2024-08.pdf`

If unavailable on sba.gov at execution time, surface — do not commit a placeholder.

---

## What's in scope

### A. Schema migrations

#### A-1. `supabase/migrations/20260429_a_deal_loan_requests_sba_50108_columns.sql`
**Conditional on PIV-2.** Add only the columns missing today. Pattern:

```sql
BEGIN;
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS seller_note_equity_portion numeric,
  ADD COLUMN IF NOT EXISTS seller_note_full_standby boolean,
  ADD COLUMN IF NOT EXISTS working_capital_justification text,
  ADD COLUMN IF NOT EXISTS lien_on_all_fixed_assets boolean,
  ADD COLUMN IF NOT EXISTS franchise_brand_id uuid REFERENCES public.franchise_brands(id),
  ADD COLUMN IF NOT EXISTS equity_injection_amount numeric,
  ADD COLUMN IF NOT EXISTS total_project_cost numeric;
COMMIT;
```

#### A-2. `supabase/migrations/20260429_b_ownership_entities_kyc_columns.sql`
```sql
BEGIN;
ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS citizenship_status text
    CHECK (citizenship_status IS NULL OR citizenship_status IN
      ('us_citizen','us_national','lawful_permanent_resident',
       'visa_holder','asylee','refugee','daca','other_ineligible','unknown')),
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS home_address_street text,
  ADD COLUMN IF NOT EXISTS home_address_city text,
  ADD COLUMN IF NOT EXISTS home_address_state text,
  ADD COLUMN IF NOT EXISTS home_address_zip text;

CREATE INDEX IF NOT EXISTS idx_ownership_entities_citizenship
  ON public.ownership_entities(deal_id, citizenship_status);
COMMIT;
```

#### A-3. `supabase/migrations/20260429_c_borrower_bank_connections.sql`
Three tables for Plaid: `borrower_bank_connections`, `borrower_bank_accounts`, `borrower_bank_transactions`. Each with `deal_id`, `bank_id`, RLS deny-default + bank-scoped read.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  borrower_id uuid REFERENCES public.borrowers(id) ON DELETE SET NULL,
  ownership_entity_id uuid REFERENCES public.ownership_entities(id) ON DELETE SET NULL,

  plaid_item_id text NOT NULL,
  plaid_access_token_encrypted text NOT NULL,
  plaid_institution_id text,
  plaid_institution_name text,
  account_count integer NOT NULL DEFAULT 0,
  earliest_transaction_date date,
  latest_transaction_date date,

  -- Consent capture (FCRA-equivalent for soft data)
  consent_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consent_ip text,
  consent_user_agent text,
  consent_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','revoked','error')),
  last_sync_at timestamptz,
  last_sync_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, plaid_item_id)
);
CREATE INDEX idx_bbc_deal ON public.borrower_bank_connections(deal_id);
CREATE INDEX idx_bbc_active ON public.borrower_bank_connections(status) WHERE status='active';

CREATE TABLE IF NOT EXISTS public.borrower_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.borrower_bank_connections(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  plaid_account_id text NOT NULL,
  account_mask text,
  account_official_name text,
  account_type text NOT NULL,
  account_subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text NOT NULL DEFAULT 'USD',
  last_balance_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id, plaid_account_id)
);
CREATE INDEX idx_bba_deal ON public.borrower_bank_accounts(deal_id);

CREATE TABLE IF NOT EXISTS public.borrower_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.borrower_bank_accounts(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  plaid_transaction_id text NOT NULL UNIQUE,
  posted_date date NOT NULL,
  authorized_date date,
  amount numeric NOT NULL,    -- Plaid: positive=debit, negative=credit
  iso_currency_code text NOT NULL DEFAULT 'USD',
  merchant_name text,
  description text,
  category_primary text,
  category_detailed text,
  is_pending boolean NOT NULL DEFAULT false,
  derived_category text,    -- 'recurring_payment'|'payroll'|'rent'|'mca'|'transfer'|'sba_loan_payment'
  derived_recurrence text,  -- 'monthly'|'biweekly'|'weekly'|'irregular'
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bbt_deal_date ON public.borrower_bank_transactions(deal_id, posted_date DESC);
CREATE INDEX idx_bbt_derived ON public.borrower_bank_transactions(deal_id, derived_category)
  WHERE derived_category IS NOT NULL;

ALTER TABLE public.borrower_bank_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrower_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrower_bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY bbc_deny ON public.borrower_bank_connections FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bbc_select ON public.borrower_bank_connections FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_bank_connections.bank_id AND m.user_id=auth.uid()));
CREATE POLICY bba_deny ON public.borrower_bank_accounts FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bba_select ON public.borrower_bank_accounts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_bank_accounts.bank_id AND m.user_id=auth.uid()));
CREATE POLICY bbt_deny ON public.borrower_bank_transactions FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bbt_select ON public.borrower_bank_transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_bank_transactions.bank_id AND m.user_id=auth.uid()));

DROP TRIGGER IF EXISTS trg_bbc_updated_at ON public.borrower_bank_connections;
CREATE TRIGGER trg_bbc_updated_at BEFORE UPDATE ON public.borrower_bank_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_bba_updated_at ON public.borrower_bank_accounts;
CREATE TRIGGER trg_bba_updated_at BEFORE UPDATE ON public.borrower_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

### B. Deal data builder

#### B-1. `src/lib/sba/dealDataBuilder.ts`

Pure-ish service: reads canonical state, returns flat record keyed to JSON Logic field names referenced in `sba_policy_rules.condition_json`.

**Output type:** `SbaEligibilityInput` — one field per `field` reference across all 22 S1 rules. Includes:

- Loan/program: `loan_amount`, `is_7a_small_loan`, `is_acquisition`, `dscr`
- Equity/sources: `equity_injection_pct_of_project`, `sources_uses_imbalance_abs`, `seller_note_used_for_equity`, `seller_note_full_standby_for_loan_term`, `seller_note_pct_of_equity`
- Use of proceeds: `working_capital_pct_of_proceeds`, `working_capital_justification_present`, `lien_on_all_fixed_assets_planned`, `use_of_proceeds_includes_mca_refi`, `use_of_proceeds_category`
- Citizenship/lookback: `all_owners_citizenship_eligible`, `ineligible_owner_in_lookback_window`
- Federal screens: `caivrs_checked` (null until S4), `caivrs_hits` (null), `borrower_has_prior_sba_loss` (null)
- Documentation: `form_4506c_signed` (null until S3/S4), `tax_transcripts_received_or_pending` (null until S4)
- Lender screens: `lender_is_federally_regulated` (from `banks.settings`), `screening_uses_sbss` (constant `false`)
- Credit elsewhere: `credit_elsewhere_test_documented`, `credit_elsewhere_finding`
- COB: `retaining_seller_present`, `retaining_seller_guarantees_2yr`, `cob_is_single_transaction`, `is_partial_cob`, `cob_transaction_type`
- Franchise: `is_franchise_deal`, `franchise_brand_on_directory`, `franchise_brand_certified_or_pre_deadline`
- Insurance: `hazard_insurance_replacement_cost_present` (null), `is_single_owner_business`, `loan_fully_secured_by_hard_collateral` (null), `loan_fully_secured_by_business_assets` (null), `key_person_life_insurance_present` (null)
- Collateral: `personal_re_collateral_decision_documented` (null until banker enters)
- Business: `business_age_years`, `employee_count`, `has_personal_guarantee`, `owner_percentage`
- 504-specific: `creates_or_retains_jobs`, `meets_public_policy_goal`, `owner_occupancy_percentage`

**Sources:**
- `deals` (single row by `dealId`)
- `deal_loan_requests` (most recent by `created_at`)
- `borrowers` (where `id = deals.borrower_id`)
- `ownership_entities` (all rows where `deal_id = dealId`)
- `financial_snapshots_v1` (most recent for the deal — for DSCR)
- `franchise_brands` (when `deal_loan_requests.franchise_brand_id` not null)
- `banks` (for `lender_is_federally_regulated` from `banks.settings.federally_regulated`)

**Sequential queries — never use Supabase join syntax without confirmed FK** (existing roadmap rule).

**Computation key cases:**

- `is_7a_small_loan` = `program === 'sba_7a_standard' && loan_amount !== null && loan_amount <= 350_000`
- `equity_injection_pct_of_project` = `equity_injection_amount / total_project_cost` when both non-null and project_cost > 0; else null
- `working_capital_pct_of_proceeds` = sum(use_of_proceeds where category in ['working_capital','WC']) / total_proceeds; null if total_proceeds === 0
- `all_owners_citizenship_eligible` = every owner has `citizenship_status` in eligible set; null if any owner has unset citizenship
- `franchise_brand_certified_or_pre_deadline` = `today < 2026-06-30 OR sba_certification_status === 'certified'` (when franchise deal)
- `seller_note_pct_of_equity` = `seller_note_equity_portion / equity_injection_amount` when both non-null and equity > 0; else null

Fields not yet computable (CAIVRS, SAM, 4506-C signing, hazard binders) explicitly return `null`. The eligibility engine treats null as "field not yet available" and the rule fails closed.

#### B-2. `src/lib/sba/__tests__/dealDataBuilder.test.ts`

Twelve cases minimum (mock supabase responses):
1. Loan 200K + sba_7a → `is_7a_small_loan = true`
2. Loan 400K + sba_7a → `is_7a_small_loan = false`
3. All owners `us_citizen` + LPR → `all_owners_citizenship_eligible = true`
4. One owner `visa_holder` → `all_owners_citizenship_eligible = false`
5. Owner with unset citizenship → `all_owners_citizenship_eligible = null`
6. No franchise → `is_franchise_deal = false`, other franchise fields null
7. Franchise with `sba_certification_status='certified'` → `franchise_brand_certified_or_pre_deadline = true`
8. Franchise with status=null + today<2026-06-30 → certified_or_pre_deadline = true
9. WC 600K of 1M proceeds → `working_capital_pct_of_proceeds = 0.6`
10. Seller note 50K of 100K equity → `seller_note_pct_of_equity = 0.5`
11. Use of proceeds includes `mca_refi` → `use_of_proceeds_includes_mca_refi = true`
12. Single owner → `is_single_owner_business = true`

#### B-3. `src/app/api/deals/[dealId]/sba/eligibility/route.ts`

```ts
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildSbaEligibilityInput } from "@/lib/sba/dealDataBuilder";
import { evaluateSBAEligibility } from "@/lib/sba/eligibility";

export async function POST(_req: Request, { params }: { params: { dealId: string } }) {
  const { dealId } = await requireDealAccess(params.dealId);
  const input = await buildSbaEligibilityInput(dealId);
  const report = await evaluateSBAEligibility({
    dealId, program: "7A",
    dealData: input as unknown as Record<string, any>,
  });
  return NextResponse.json({ ok: true, report, input });
}
```

### C. Plaid integration

#### C-1. Delete `src/lib/integrations/plaid.ts` (3-line stub)

#### C-2. Create `src/lib/integrations/plaid/`

Module structure:
- `client.ts` — Plaid SDK setup using `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- `linkToken.ts` — `createLinkToken({ dealId, ownershipEntityId, userId, redirectUri })` calls Plaid `/link/token/create` with products `['transactions', 'auth', 'identity']`, country_codes US, webhook URL `process.env.PLAID_WEBHOOK_URL`, returns `{ link_token, expiration }`
- `exchangeToken.ts` — `exchangePublicToken(publicToken, metadata)` calls Plaid `/item/public_token/exchange`, encrypts access_token using `PLAID_ACCESS_TOKEN_ENCRYPTION_KEY` (AES-256-GCM), persists `borrower_bank_connections` row with consent capture, fires deferred sync
- `sync.ts` — `syncTransactions(connectionId)` uses Plaid `/transactions/sync` cursor pattern, writes accounts + transactions, handles `INITIAL_UPDATE`, `HISTORICAL_UPDATE`, `DEFAULT_UPDATE`, `TRANSACTIONS_REMOVED`. Idempotent on `plaid_transaction_id`.
- `classifier.ts` — pure function `classifyTransaction(tx) -> { derived_category, derived_recurrence }` per pattern table below
- `types.ts` — shared types

**Classifier pattern table:**

| Pattern | derived_category | derived_recurrence |
|---|---|---|
| Recurring same merchant + monthly cadence + debit > 0 | `recurring_payment` | `monthly` |
| `description ~* /payroll|gusto|adp|paychex/` | `payroll` | as detected |
| `description ~* /\brent\b|lease/` + monthly cadence | `rent` | `monthly` |
| `description ~* /MCA|merchant cash|cleartocash|kapitus|forwardline|onDeck|libertas/` | `mca` | as detected |
| `description ~* /transfer|zelle|venmo|cash app/` | `transfer` | irregular |
| `description ~* /SBA loan|SBA-7A|small business administration/` | `sba_loan_payment` | `monthly` |
| Else | null | null |

Recurrence detection: group by normalized merchant_name; if 3+ occurrences within 100 days at consistent interval (28–32 days = monthly, 13–15 = biweekly, 6–8 = weekly), set recurrence accordingly.

#### C-3. API routes

- `src/app/api/borrower/plaid/link-token/route.ts` (POST) — generates Link token; returns `{ link_token, expiration }`
- `src/app/api/borrower/plaid/exchange/route.ts` (POST) — body `{ public_token, metadata, deal_id, ownership_entity_id, consent_version, consent_text_hash }`; exchanges + persists; fires sync
- `src/app/api/borrower/plaid/webhook/route.ts` (POST) — verifies Plaid signature header `Plaid-Verification`, dispatches by webhook_type/code

All three routes: `runtime = "nodejs"`, `maxDuration = 60`. Webhook signature verification uses Plaid's JWT-based pattern (Plaid docs current as of 2026).

#### C-4. `src/lib/integrations/plaid/__tests__/classifier.test.ts`

Fifteen-plus realistic transaction descriptions:
- "GUSTO PAYROLL" → payroll
- "ADP PAYROLL FEES" → payroll
- "Capital One Mortgage Pmt" → recurring_payment monthly
- "ClearToCash MCA Funding" → mca
- "Kapitus Daily Remittance" → mca
- "Zelle to John Doe" → transfer
- "Venmo Payment" → transfer
- "Office Rent — 123 Main St LLC" → rent monthly
- "SBA 7(a) Loan Payment" → sba_loan_payment
- "STARBUCKS #4521" → null (not classified)
- "Comcast Internet" recurring → recurring_payment monthly
- "Verizon Wireless" recurring → recurring_payment monthly
- One-off "Best Buy" purchase → null
- Recurring "Aetna Insurance Premium" → recurring_payment monthly
- "Forwardline Capital Daily" → mca

### D. Form 1919 — full fielding

#### D-1. `src/lib/sba/forms/form1919/fields.ts`

Field map per section. Source: SBA Form 1919 (current revision dated June 2025 per SOP 50 10 8 release).

**Section I (applicant business)** — required fields:
`applicant_legal_name, applicant_dba, applicant_ein, applicant_address_street, applicant_address_city, applicant_address_state, applicant_address_zip, applicant_phone, applicant_business_type, applicant_naics, applicant_employee_count, applicant_year_founded, loan_amount, loan_program, use_of_proceeds_summary, is_franchise_deal, franchise_identifier_code, franchise_brand_name, has_other_sba_application_pending, has_been_in_bankruptcy_pending, has_pending_lawsuits, is_engaged_in_lobbying`

**Section II (per individual subject to disclosure — every 20%+ owner, officer, GP, day-to-day manager, trustor)** — required fields:
`full_name, ssn_last4, date_of_birth, place_of_birth, is_us_citizen, is_us_national, is_lpr, alien_registration_number, home_address_street, home_address_city, home_address_state, home_address_zip, is_employee_of_us_government, has_other_government_employment, has_been_arrested_or_charged_in_6mo, has_been_convicted_or_pleaded, has_pending_criminal_charges, is_subject_to_indictment, has_paroled_or_probation`

**Form 912 trigger:** if any of `has_been_arrested_or_charged_in_6mo`, `has_been_convicted_or_pleaded`, `has_pending_criminal_charges`, `is_subject_to_indictment`, `has_paroled_or_probation` is true → `triggers_form_912 = true` for that person.

**Section III (per equity-owning entity)** — required fields:
`legal_name, ein, entity_type, address_street, address_city, address_state, address_zip`

#### D-2. `src/lib/sba/forms/form1919/build.ts`

Pure function `buildForm1919(input: Form1919Input): Form1919BuildResult`. Returns:
```ts
{
  form: "1919",
  input,
  missing: {
    section_i: string[],
    section_ii: Array<{ ownership_entity_id: string; missing: string[] }>,
    section_iii: Array<{ ownership_entity_id: string; missing: string[] }>,
  },
  triggers_form_912: boolean,
  is_complete: boolean,
}
```

`is_complete` = all three sections have empty `missing` arrays.

#### D-3. `src/lib/sba/forms/form1919/inputBuilder.ts`

Async `buildForm1919Input(dealId): Promise<Form1919Input>`. Sources:
- Section I fields from `deals + deal_loan_requests + borrowers + franchise_brands`
- Section II persons from `ownership_entities` filtered to `entity_type='individual'`
- Section III entities from `ownership_entities` filtered to `entity_type IN ('corporation','llc','partnership','trust')`

For Section II person fields (DOB, citizenship, address): read from `ownership_entities` columns added in A-2 + fallback to `evidence_json` keys for backward compat.

#### D-4. `src/lib/sba/forms/form1919/render.ts`

Uses `pdf-lib` (already in package.json — used elsewhere). Loads `public/sba-templates/form-1919-rev-2025-06.pdf`. If template has AcroForm fields, set values via `form.getTextField(name).setText(value)`. Otherwise overlay using `pdf-lib` text drawing at coordinates declared in `fields.ts` per-field `pdfCoord: { page, x, y }` metadata.

**Don't block on perfect coordinates** — first commit can render a draft with approximate positions; banker QA will refine. Coordinate map iteration is a follow-up sprint task.

#### D-5. API routes

- `src/app/api/deals/[dealId]/sba/forms/1919/build/route.ts` (GET) — returns `Form1919BuildResult` JSON
- `src/app/api/deals/[dealId]/sba/forms/1919/render/route.ts` (GET) — returns `application/pdf`

Both: `runtime = "nodejs"`, `maxDuration = 30`.

#### D-6. `src/lib/sba/forms/form1919/__tests__/build.test.ts`

Cases:
- Empty input → all required missing in all sections
- Section I complete + 1 person fully populated + 0 entities → `is_complete=true`
- Person with `has_been_convicted_or_pleaded=true` → `triggers_form_912=true`
- Multiple persons, one missing SSN → `section_ii` correctly identifies which person via `ownership_entity_id`
- Section III entity missing EIN → `section_iii[*].missing` includes `'ein'`

### E. Form 413 — Personal Financial Statement

Same module pattern at `src/lib/sba/forms/form413/`:
- `fields.ts` — ~50 fields per signer (assets, liabilities, income, contingent, signatures, spouse signature)
- `build.ts` — pure function with missing-field detection + 90-day staleness check
- `inputBuilder.ts` — pulls per-owner from `ownership_entities` + `borrower_applicant_financials` (table from migration 20260425)
- `render.ts` — pdf-lib overlay onto `public/sba-templates/form-413-rev-2024-08.pdf`
- API routes mirror 1919: `/api/deals/[dealId]/sba/forms/413/build/route.ts`, `/render/route.ts`
- `__tests__/build.test.ts` — empty/partial/complete + spouse signature presence + staleness logic

**Form 413 staleness:** dated within 90 days of submission. Build result includes:
```ts
signature: {
  has_valid_signature: boolean;     // false until S3 e-sign
  signed_at: string | null;
  expires_at: string | null;        // signed_at + 90d
  needs_resignature: boolean;       // true when expires_at within 14d
}
```

### F. Story tab integration (lightweight)

#### F-1. `src/components/deals/cockpit/SbaFormReadinessPanel.tsx`

New panel inside Story tab (existing convention from Phase 52). Shows:
- Per-form status: "Form 1919: 12 fields missing" with link to deep-dive
- Per-person fields-missing list grouped by `ownership_entity_id`
- "Sign Form 1919" button — disabled until S3 e-sign ships (placeholder `disabled title="Available after identity verification (Sprint 3)"`)

Uses existing `useCockpitStateContext()` pattern. No new state provider.

#### F-2. `src/components/deals/cockpit/StoryPanel.tsx` — surgical addition

Add `<SbaFormReadinessPanel />` as a new section after the existing "Buddy's Questions" + "Deal Story Fields" + "Credit Interview" sections. Don't bolt below cockpit page — keep inside Story tab per Phase 52 principle.

### G. Eligibility engine wiring

#### G-1. After every Plaid sync, re-run eligibility

`src/lib/integrations/plaid/sync.ts` — at end of successful sync, fire-and-forget call to:
```ts
const input = await buildSbaEligibilityInput(connection.deal_id);
await evaluateSBAEligibility({ dealId: connection.deal_id, program: "7A",
  dealData: input as any });
```

Wrapped in try/catch with `console.error` only — not fatal. Eligibility re-evaluation on Plaid sync surfaces newly-detected MCAs (via `derived_category='mca'`) into `use_of_proceeds_includes_mca_refi` if they appear in use_of_proceeds.

---

## Tests required

| File | Coverage |
|---|---|
| `src/lib/sba/__tests__/dealDataBuilder.test.ts` | 12 cases minimum |
| `src/lib/integrations/plaid/__tests__/classifier.test.ts` | 15+ realistic descriptions across all 6 categories |
| `src/lib/sba/forms/form1919/__tests__/build.test.ts` | 5 cases (empty/partial/complete/912-trigger/section-ii-isolation) |
| `src/lib/sba/forms/form413/__tests__/build.test.ts` | 5 cases (empty/partial/complete/spouse/staleness) |

`vitest run` clean. Coverage ≥80% on new pure-logic files.

---

## Environment variables

Add to Vercel + `.env.example`:

```
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
PLAID_WEBHOOK_URL=https://buddytheunderwriter.com/api/borrower/plaid/webhook
PLAID_ACCESS_TOKEN_ENCRYPTION_KEY=  # 32-byte base64 key
```

Sandbox in dev. Production credentials gated behind separate env. Multi-tenant Plaid (per-bank credentials) deferred to v2.

---

## Verification (V-2)

**V-2a — Migrations applied**
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('borrower_bank_connections','borrower_bank_accounts','borrower_bank_transactions');
-- Expected: 3

SELECT count(*) FROM information_schema.columns
WHERE table_schema='public' AND table_name='ownership_entities'
  AND column_name='citizenship_status';
-- Expected: 1
```

**V-2b — Eligibility route works on Samaritus**
```sh
curl -X POST .../api/deals/d65cc19e-b03e-4f2d-89ce-95ee69472cf3/sba/eligibility \
  -H "Authorization: Bearer <clerk-jwt>"
```
Returns 200 with `report` + `input`. `report.passed_rules + report.hard_stops + report.mitigations_required + report.advisories` total = 22 (or fewer if filtered to 7A only).

**V-2c — Plaid sandbox round-trip**
1. POST `/api/borrower/plaid/link-token` returns valid `link_token`
2. Use Plaid Link sandbox → returns `public_token`
3. POST `/api/borrower/plaid/exchange` with public_token → `borrower_bank_connections` row created with status='active'
4. Webhook fires → `borrower_bank_transactions` populated
5. ≥50% of transactions have non-null `derived_category`

**V-2d — Form 1919 build endpoint**
```sh
curl .../api/deals/<test-deal-id>/sba/forms/1919/build
```
Returns structured JSON with `missing.section_i`, `missing.section_ii`, `missing.section_iii`, `triggers_form_912`, `is_complete`.

**V-2e — Form 1919 render endpoint**
```sh
curl .../api/deals/<test-deal-id>/sba/forms/1919/render -o test.pdf
```
PDF opens. Visible fields populated where data exists. Coordinates approximate — banker QA accepted in this sprint.

**V-2f — Form 413 same checks**

**V-2g — `tsc --noEmit` clean, `vitest run` clean**

**V-2h — GitHub API verification**
Read each spec'd file from `main`. All present.

---

## Non-goals

- E-signature ceremony (S3) — `Form1919BuildResult.signature.has_valid_signature` is hardcoded `false` until S3 wires it
- IAL2 verification (S3)
- Soft-pull credit bureau (S4)
- 4506-C IRS submission (S4)
- Forms 1920, 912, 4506-C, 155, 159 (S4)
- Third-party orchestration (S5)
- Auto-built debt schedule from Plaid transactions (S4 wires this; classifier here just labels)
- Equity injection seasoning verification (S4 — needs Plaid history + bank statements)

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | `ownership_entities.evidence_json` missing citizenship for existing deals | High | A-2 adds top-level `citizenship_status` column; backfill from `evidence_json` where present; null otherwise → eligibility rule fails closed → surfaces in Story tab |
| 2 | Form 1919 PDF coordinates change when SBA updates form | Medium | Track `template_version` (S3 schema); re-fielding is 1-day task |
| 3 | Plaid sandbox doesn't cover all production institutions | Low | Plaid sandbox is comprehensive; staging uses development env |
| 4 | `borrower_bank_transactions` grows fast (50K+ per deal) | Low | Indexed `(deal_id, posted_date DESC)`; query patterns are date-range |
| 5 | Plaid access token encryption key management | Medium | v1: env var. v2: AWS KMS / Supabase Vault (separate sprint) |
| 6 | Form input builder relies on data not yet collected | High | Returns null fields; build function captures in `missing` arrays; gap engine surfaces in Story tab |
| 7 | Pulse fastlane noise from new event types (`plaid.connection_created`, `plaid.sync_completed`) | Medium | Recommended: ship D3 spec before/with this sprint to silence config-state errors |

---

## Hand-off commit message

```
spec(sba-30min-package/s2): forms 1919/413 + Plaid + deal data builder

- 3 new tables: borrower_bank_connections/accounts/transactions
- ownership_entities columns: citizenship_status, dob, address
- deal_loan_requests columns: seller note + WC + franchise + project cost
- src/lib/sba/dealDataBuilder.ts: derives 22 SOP 50 10 8 rule fields
- src/lib/integrations/plaid/: client + linkToken + exchange + sync + classifier + types
- src/lib/sba/forms/form1919/: fields + build + inputBuilder + render + 2 routes
- src/lib/sba/forms/form413/: same pattern
- SbaFormReadinessPanel in Story tab
- 4 new test files; ≥80% coverage on pure logic
- /api/deals/[dealId]/sba/eligibility route wires builder + engine
- Plaid sync triggers fire-and-forget eligibility re-eval

Verification: V-2a through V-2h
Spec: specs/sba-30min-package/SPEC-S2-forms-and-plaid.md
```

---

## Addendum for Claude Code

**Judgment boundaries:**

- If PIV-2 reveals all `deal_loan_requests` columns already present → skip A-1, surface
- If PIV-3 reveals `ownership_entities` already has `citizenship_status` → skip its addition in A-2, keep DOB/address additions
- If PIV-6 reveals SBA PDF template not available → surface; do not ship a placeholder PDF. Render route returns `{ ok: false, reason: "TEMPLATE_NOT_AVAILABLE" }` until template committed
- If `pdf-lib` AcroForm fill fails on official SBA PDF (some SBA PDFs are flat) → fall back to text-overlay strategy; surface for coordinate-map iteration
- Coordinate maps in `fields.ts` `pdfCoord` metadata: best-effort; don't block on pixel-perfect placement. Banker QA will refine in follow-up. The contract is `key + label + section + required + resolver` — `pdfCoord` is rendering hint only
- If existing `cockpit-state` provider doesn't expose form-readiness data: surface. Don't refactor cockpit-state in this sprint. Add a separate fetch in `SbaFormReadinessPanel` calling `/api/deals/[dealId]/sba/forms/1919/build` directly

**Pulse fastlane:** new event types added — `plaid.connection_created`, `plaid.connection_revoked`, `plaid.sync_completed`, `plaid.sync_failed`, `sba.eligibility_evaluated`. Each will emit `pulse.forwarding_failed: pulse_mcp_disabled` once per event until D3 ships. Acceptable, noisy. Strongly recommend D3 ships before or alongside this sprint.

**Form prose:** D-1's field labels and section headers should match the official Form 1919. When the official PDF text and the spec's label disagree, the official PDF wins. Update `fields.ts` labels accordingly; surface significant deviations.
