# SPEC S4 — Soft-Pull Credit + CAIVRS + SAM.gov + IRS 4506-C + Remaining Forms

**Date:** 2026-04-25 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 1.5–2 weeks · **Risk:** Medium-high (FCRA compliance; IRS API quirks; multiple vendor integrations)

**Depends on:** S2 (Plaid foundation; deal data builder), S3 (IAL2 + e-sign for 4506-C signing)

**Blocks:** S5 (final E-Tran submission depends on completed 4506-C signature)

---

## Background

This sprint completes the borrower-data acquisition layer:

1. **Soft-pull credit bureau integration.** Per the conversation: soft pull only, never hard. FCRA § 1681b(a)(2) permissible purpose with explicit written consent. Returns same tradeline data as a hard pull, no score impact, no consumer-side adverse action. Bank tenant performs the hard pull as part of credit decision after package delivery (their decision, their adverse-action notice, their FCRA exposure).

2. **CAIVRS check.** Mandatory under SOP 50 10 8. Federal debt default check via SBA-authorized CAIVRS access. No integration today means it's a manual checkbox the banker has to remember — and there's no rule failure if they forget.

3. **SAM.gov exclusion check.** Borrower + agents checked against System for Award Management exclusions. Free public API.

4. **IRS 4506-C scaffold.** Mandatory under SOP 50 10 8. Borrower e-signs 4506-C at minute 1. IRS returns transcripts in 3–10 days. Reconciliation against borrower-provided returns happens async; discrepancies flow as gaps. The e-sign capture is immediate; the IRS submission API + polling is background.

5. **Remaining forms.** 1920, 912 (conditional on 1919 character triggers), 4506-C (mandatory), 155 (when seller note as equity), 159 (only if agent used). Same module pattern as S2 forms — fields → build → inputBuilder → render → 2 routes → tests.

6. **Equity injection seasoning verifier.** Uses Plaid transactions from S2 to verify 30–90 days of source-of-funds. Closes the third leg of the three-way Sources & Uses tie-out.

7. **Auto-built business debt schedule.** Uses Plaid `derived_category` from S2 classifier — recurring payments, MCAs, SBA loans — to construct the debt schedule automatically; banker reviews and confirms. Drives DSCR computation.

## Build principles captured

**#20 — Soft pull only, never hard. No exceptions, no flags.** The temptation to "flip a flag later" is the kind of thing that produces a SoFi-class lawsuit. There's no flag.

**#21 — Consent artifacts are permanent and immutable.** Every credit pull, bank connection, IRS request stores: consent version, content hash, IP, user agent, timestamp. Examiner-grade.

**#22 — IRS is async by design.** Don't pretend the 4506-C round-trip is real-time. Borrower's experience: "Buddy submitted your 4506-C; transcripts will arrive in 3–10 days, you don't need to wait."

**#23 — Credit-bureau abnormalities flow through existing gap engine.** Don't build a separate "credit explanation" UI. The Story tab + Borrower Voice + `deal_gap_queue` from Phase 50 is the right place. Tradelines with abnormalities → gap entries → borrower explains in their own words → captured in credit memo.

---

## Pre-implementation verification (PIV)

### PIV-1 — S2 Plaid integration shipped
Confirm `borrower_bank_connections`, `_accounts`, `_transactions` tables exist + Plaid module live.

### PIV-2 — S3 IAL2 + e-sign shipped
Confirm `borrower_identity_verifications` + `signed_documents` tables exist; `hasValidIal2()` callable.

### PIV-3 — Vendor selection
Three vendor picks needed before code:
- **Soft-pull bureau:** Plaid Check (default) | Array | MeasureOne | direct TU/EFX/EXP
- **CAIVRS access:** SBA-authorized direct (requires SBA application) | intermediary
- **IRS 4506-C submission:** IRS direct (slow approvals) | NCS | IDology | Wolters Kluwer

Surface picks + Matt confirms before integration code begins. Schema tolerates all options via `vendor` column on each table.

### PIV-4 — FCRA consent text version
Confirm consent disclosure text reviewed by counsel. Stored as content hash; the actual text persists in `public/consent-templates/credit-pull-consent-v1.md`. If no signed-off version available → surface; do not ship without legal review of disclosure text.

### PIV-5 — IRS 4506-C form availability
Form 4506-C revision date confirmed. Source: irs.gov. Commit to `public/sba-templates/form-4506c-rev-2024-10.pdf`.

### PIV-6 — DocuSeal templates available for new forms
- Form 1920 template uploaded to DocuSeal
- Form 912 template uploaded
- Form 4506-C template uploaded
- Form 155 template uploaded
- Form 159 template uploaded (rarely used; can defer)

Capture template IDs in env. If templates not yet uploaded → surface.

---

## What's in scope

### A. Schema migrations

#### A-1. `supabase/migrations/20260520_a_borrower_credit_pulls.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_credit_pulls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  ownership_entity_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,

  -- HARD CONSTRAINT: pull_type is always 'soft'. No hard pull anywhere.
  pull_type text NOT NULL DEFAULT 'soft' CHECK (pull_type = 'soft'),

  vendor text NOT NULL CHECK (vendor IN ('plaid_check','array','measureone','transunion','equifax','experian')),
  vendor_request_id text NOT NULL,
  bureau text CHECK (bureau IN ('TU','EFX','EXP')),

  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','completed','failed','expired')),
  status_reason text,

  -- Consent (FCRA § 1681b(a)(2) — written instruction)
  consent_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consent_ip text,
  consent_user_agent text,
  consent_at timestamptz NOT NULL,

  -- Idempotency
  idempotency_key text NOT NULL UNIQUE,

  -- Result references
  result_storage_path text,    -- raw vendor JSON in Supabase Storage
  result_summary jsonb,        -- denormalized highlights for fast read
  fico_score integer,          -- if soft-pull yields it (some vendors return)
  delinquencies_count integer,
  public_records_count integer,
  inquiries_24mo_count integer,

  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bcp_deal ON public.borrower_credit_pulls(deal_id);
CREATE INDEX idx_bcp_entity ON public.borrower_credit_pulls(ownership_entity_id);
CREATE INDEX idx_bcp_status ON public.borrower_credit_pulls(status) WHERE status='requested';

ALTER TABLE public.borrower_credit_pulls ENABLE ROW LEVEL SECURITY;
CREATE POLICY bcp_deny ON public.borrower_credit_pulls FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bcp_select_bank ON public.borrower_credit_pulls FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_credit_pulls.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_bcp_updated_at ON public.borrower_credit_pulls;
CREATE TRIGGER trg_bcp_updated_at BEFORE UPDATE ON public.borrower_credit_pulls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.borrower_credit_tradelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pull_id uuid NOT NULL REFERENCES public.borrower_credit_pulls(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  account_type text,        -- 'mortgage'|'auto_loan'|'credit_card'|'student_loan'|'other'
  creditor_name text,
  account_number_masked text,
  open_date date,
  closed_date date,
  high_credit numeric,
  current_balance numeric,
  monthly_payment numeric,
  payment_history_24mo text, -- e.g. '111111111111111111111111' (1=on time, 2=30day, 3=60day...)
  is_delinquent boolean NOT NULL DEFAULT false,
  is_charged_off boolean NOT NULL DEFAULT false,
  is_in_collection boolean NOT NULL DEFAULT false,

  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bct_pull ON public.borrower_credit_tradelines(pull_id);
CREATE INDEX idx_bct_abnormal ON public.borrower_credit_tradelines(deal_id)
  WHERE is_delinquent OR is_charged_off OR is_in_collection;

ALTER TABLE public.borrower_credit_tradelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY bct_deny ON public.borrower_credit_tradelines FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY bct_select_bank ON public.borrower_credit_tradelines FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_credit_tradelines.bank_id AND m.user_id=auth.uid())
);

COMMIT;
```

#### A-2. `supabase/migrations/20260520_b_borrower_caivrs_sam.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_caivrs_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  ownership_entity_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,

  caivrs_authorization_number text,  -- returned by CAIVRS API on successful check
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','clear','hit','error','expired')),
  hit_count integer NOT NULL DEFAULT 0,
  hit_details jsonb NOT NULL DEFAULT '[]'::jsonb,

  consent_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consent_at timestamptz NOT NULL,

  idempotency_key text NOT NULL UNIQUE,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_caivrs_deal ON public.borrower_caivrs_checks(deal_id);
CREATE INDEX idx_caivrs_status ON public.borrower_caivrs_checks(status);
CREATE INDEX idx_caivrs_active ON public.borrower_caivrs_checks(deal_id, ownership_entity_id, expires_at DESC)
  WHERE status='clear';

ALTER TABLE public.borrower_caivrs_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY caivrs_deny ON public.borrower_caivrs_checks FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY caivrs_select ON public.borrower_caivrs_checks FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_caivrs_checks.bank_id AND m.user_id=auth.uid())
);

CREATE TABLE IF NOT EXISTS public.borrower_sam_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Either an entity or an individual is checked
  ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  borrower_id uuid REFERENCES public.borrowers(id),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','clear','hit','error')),
  hit_count integer NOT NULL DEFAULT 0,
  hit_details jsonb NOT NULL DEFAULT '[]'::jsonb,

  idempotency_key text NOT NULL UNIQUE,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (ownership_entity_id IS NOT NULL OR borrower_id IS NOT NULL)
);

CREATE INDEX idx_sam_deal ON public.borrower_sam_exclusions(deal_id);
CREATE INDEX idx_sam_active ON public.borrower_sam_exclusions(deal_id, expires_at DESC)
  WHERE status='clear';

ALTER TABLE public.borrower_sam_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sam_deny ON public.borrower_sam_exclusions FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY sam_select ON public.borrower_sam_exclusions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_sam_exclusions.bank_id AND m.user_id=auth.uid())
);

COMMIT;
```

#### A-3. `supabase/migrations/20260520_c_borrower_irs_transcripts.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_irs_transcript_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Either business or individual
  ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  borrower_id uuid REFERENCES public.borrowers(id),

  vendor text NOT NULL DEFAULT 'irs_direct'
    CHECK (vendor IN ('irs_direct','ncs','idology','wolters_kluwer')),
  vendor_request_id text,

  signed_4506c_id uuid REFERENCES public.signed_documents(id),
  tax_years integer[] NOT NULL,
  transcript_types text[] NOT NULL,  -- e.g. ['return','wage_income','account']

  status text NOT NULL DEFAULT 'pending_signature'
    CHECK (status IN ('pending_signature','submitted','received','reconciled','failed','expired')),
  status_reason text,

  submitted_at timestamptz,
  received_at timestamptz,
  next_poll_at timestamptz,
  poll_attempt_count integer NOT NULL DEFAULT 0,

  -- Result
  transcripts_storage_path text,    -- raw IRS PDFs/JSON
  reconciliation_summary jsonb,

  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (ownership_entity_id IS NOT NULL OR borrower_id IS NOT NULL)
);

CREATE INDEX idx_irs_deal ON public.borrower_irs_transcript_requests(deal_id);
CREATE INDEX idx_irs_pending ON public.borrower_irs_transcript_requests(next_poll_at)
  WHERE status='submitted' AND next_poll_at IS NOT NULL;

ALTER TABLE public.borrower_irs_transcript_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY irs_deny ON public.borrower_irs_transcript_requests FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY irs_select ON public.borrower_irs_transcript_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_irs_transcript_requests.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_irs_updated_at ON public.borrower_irs_transcript_requests;
CREATE TRIGGER trg_irs_updated_at BEFORE UPDATE ON public.borrower_irs_transcript_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

### B. Soft-pull credit integration

#### B-1. `src/lib/integrations/creditBureau/`

Module structure:
- `client.ts` — vendor abstraction; v1 implements Plaid Check
- `request.ts` — `requestSoftPull({ dealId, bankId, ownershipEntityId, taxIdLast4, ssnFull, dateOfBirth, address, consentVersion, consentTextHash, consentIp, consentUserAgent })`
- `parser.ts` — pure function `parseCreditReport(rawJson, vendor) -> { tradelines, summary }` returning structured tradelines array + summary fields
- `gapDetector.ts` — pure function `detectAbnormalities(tradelines) -> Array<{ tradeline_id, abnormality_type, severity, suggested_explanation_prompt }>`
- `__tests__/parser.test.ts`
- `__tests__/gapDetector.test.ts`

**`requestSoftPull` invariants:**
1. Idempotency key: `sha256(deal_id:owner_id:vendor:date)` — same day same owner same vendor returns existing record
2. Consent capture **mandatory** — function rejects if any consent field missing
3. Inserts `borrower_credit_pulls` row with status='requested'
4. Calls vendor API with explicit `pull_type: 'soft'` flag (Plaid Check distinguishes hard/soft via the API call)
5. Persists raw response to Supabase Storage at `credit-reports/${deal_id}/${pull_id}.json` (encrypted bucket)
6. Calls `parseCreditReport`; inserts `borrower_credit_tradelines` rows
7. Calls `detectAbnormalities`; for each abnormality, inserts a `deal_gap_queue` row with `gap_type='credit_explanation'`, `fact_key=tradeline_id`, `gap_metadata: { abnormality_type, suggested_explanation_prompt }`
8. Updates `borrower_credit_pulls.status='completed'`, `completed_at`, `result_summary`, `fico_score` (if returned), `delinquencies_count`, `public_records_count`, `inquiries_24mo_count`
9. Inserts `deal_event` with `event_type: 'credit_pull.completed'`

**Abnormality detection:**

| Tradeline characteristic | Abnormality | Severity |
|---|---|---|
| `is_charged_off = true` | charge_off | HIGH |
| `is_in_collection = true` | collection | HIGH |
| `payment_history_24mo` contains '3' (60-day) or worse in last 12 months | recent_delinquency | HIGH |
| `payment_history_24mo` contains '2' (30-day) in last 12 months | mild_delinquency | MEDIUM |
| `account_type='credit_card' AND current_balance/high_credit > 0.85` | high_utilization | MEDIUM |
| `inquiries_24mo > 6` | excessive_inquiries | LOW |
| `current_balance > $100K` for non-mortgage | large_unsecured_debt | INFO |

Each abnormality gets a `suggested_explanation_prompt` written in plain language for the borrower:
- charge_off: "We see a charged-off account from {creditor} for ${balance}. Tell us what happened."
- collection: "There's a collection account with {creditor}. What's the story?"
- recent_delinquency: "We see a 60-day late on {creditor} in {month}. What was going on at that time?"

These flow into the existing `deal_gap_queue` → Story tab gap-resolution flow → Borrower Voice can address them naturally → captured in credit memo via existing infrastructure. **No new UI needed.**

#### B-2. API route: `POST /api/deals/[dealId]/credit-pull/request`

Body: `{ ownership_entity_id, consent_version, consent_text_hash }` + reads borrower data from canonical state. `runtime = "nodejs"`, `maxDuration = 60`.

Soft-pull is gated on **explicit consent capture** but NOT gated on IAL2 (different scope from e-sign). The consent record itself is the FCRA-required artifact.

#### B-3. Tests

`src/lib/integrations/creditBureau/__tests__/parser.test.ts` — 8 cases parsing realistic bureau JSON variants (Plaid Check format, Array format if implemented)

`src/lib/integrations/creditBureau/__tests__/gapDetector.test.ts` — 7 cases, one per abnormality type plus a clean tradeline (no abnormalities)

### C. CAIVRS + SAM.gov

#### C-1. `src/lib/integrations/caivrs/`

CAIVRS access requires SBA-authorized credentials (HUD-issued; banks typically already have these). v1 implementation:
- `client.ts` — wraps SBA-authorized CAIVRS API endpoint
- `service.ts` — `runCaivrsCheck({ dealId, bankId, ownershipEntityId, ssnFull, consentArtifact })` — queries CAIVRS, persists `borrower_caivrs_checks` row, returns `{ ok, status, hit_count, authorization_number }`

Idempotency: per (deal, owner, calendar day) — same-day re-checks return existing record.

90-day expiry — CAIVRS authorization number is valid for 90 days for the loan; after that, re-check required. `expires_at` column drives this.

#### C-2. `src/lib/integrations/samGov/`

SAM.gov has a free public API at `https://api.sam.gov/entity-information/v3/exclusions`. No auth needed for public endpoint; rate-limited.

- `client.ts` — `fetchSamExclusions({ name, ein? })` — returns array of matching exclusion records
- `service.ts` — `runSamCheck({ dealId, bankId, entityId | borrowerId, name, ein })` — persists `borrower_sam_exclusions` row

Each ownership_entity (people + entities) gets a SAM check. Borrower business gets a check on legal name + EIN.

#### C-3. API routes

- `POST /api/deals/[dealId]/caivrs/run` — body `{ ownership_entity_id }`; returns check result
- `POST /api/deals/[dealId]/sam/run` — body `{ ownership_entity_id? | borrower? }`; returns check result

Both update `dealDataBuilder` derived fields:
- `caivrs_checked = true` when at least one check exists for the deal
- `caivrs_hits = sum(hit_count) across all owners`
- `borrower_has_prior_sba_loss = true` if any caivrs hit_details indicates prior SBA loss

Update `src/lib/sba/dealDataBuilder.ts` to read these fields from new tables. Add new test cases in `dealDataBuilder.test.ts`.

#### C-4. Tests

- `src/lib/integrations/caivrs/__tests__/service.test.ts` — clear / hit / error / idempotency cases
- `src/lib/integrations/samGov/__tests__/client.test.ts` — exclusion match / no match / rate-limit-handling

### D. IRS 4506-C scaffold

#### D-1. Form 4506-C generator

Following S2 pattern at `src/lib/sba/forms/form4506c/`:
- `fields.ts` — IRS Form 4506-C fields (taxpayer name, taxpayer ID, spouse name + ID if joint, current address, previous address if recent move, third-party recipient name + address + phone, transcripts requested checkboxes [Return Transcript / Account Transcript / Wage and Income / Verification of Non-filing], tax form numbers requested, years requested, signature date, taxpayer signature, spouse signature)
- `build.ts` — pure validation, missing-field detection
- `inputBuilder.ts` — pulls from `ownership_entities` + `deals` + `banks` (third-party recipient = lender bank info from `banks.settings.irs_third_party`)
- `render.ts` — pdf-lib overlay onto `public/sba-templates/form-4506c-rev-2024-10.pdf`
- API routes: `/build`, `/render`
- `__tests__/build.test.ts`

#### D-2. IRS submission service

`src/lib/integrations/irsTranscripts/`:
- `client.ts` — vendor abstraction; v1 implements one of: IRS direct (slow, requires Designated User auth), NCS, IDology, Wolters Kluwer. **Vendor pick deferred to PIV-3 surface step.**
- `submission.ts` — `submitTranscriptRequest({ dealId, bankId, ownershipEntityId | borrowerId, signed4506cId, taxYears, transcriptTypes })`. Requires a completed `signed_documents` row with `form_code='FORM_4506C'` — reads PDF from storage, submits to vendor.
- `polling.ts` — `pollPendingTranscripts()` — queries `borrower_irs_transcript_requests` where `status='submitted' AND next_poll_at < NOW()`. Polls each. Updates `next_poll_at` per cadence:
  - First 48h post-submit: poll every 4h
  - 48h–7d: poll every 24h
  - 7d–14d: poll every 48h
  - >14d: stop polling, mark `status='expired'`, surface gap "IRS transcripts not received in expected window"
- `reconciler.ts` — when transcripts received, parse → compare against borrower-provided tax returns (via `deal_financial_facts`) → emit `deal_gap_queue` rows for material discrepancies (>$1,000 difference on AGI / gross receipts / etc.)

#### D-3. API routes

- `POST /api/deals/[dealId]/irs-transcripts/submit` — body `{ ownership_entity_id | borrower_id, tax_years, transcript_types }`. Verifies signed 4506-C exists; calls submission. Returns `{ ok, request_id }`
- `GET /api/deals/[dealId]/irs-transcripts/[requestId]/status` — returns current status + ETA

#### D-4. Cron job for polling

`src/lib/jobs/pollIrsTranscripts.ts` — entry point for Cloud Run cron. Runs every 30 minutes. Iterates pending requests; calls `pollingService`. Idempotent — same request handled once per cron run via row-level update locking.

Cloud Run cron deployment optional in this sprint (separate from worker fleet) — the library function + tests are mandatory; cron deployment can be a follow-up if time-constrained.

#### D-5. Tests

- `src/lib/integrations/irsTranscripts/__tests__/submission.test.ts` — happy path / missing 4506-C / vendor failure / idempotency
- `src/lib/integrations/irsTranscripts/__tests__/polling.test.ts` — 4h cadence / 24h cadence / expiry / row locking
- `src/lib/integrations/irsTranscripts/__tests__/reconciler.test.ts` — match / mismatch on AGI / mismatch on gross receipts / multi-year reconciliation

### E. Equity injection seasoning verifier

#### E-1. `src/lib/sba/equitySeasoning.ts`

Pure function `verifyEquitySeasoning({ equityAmount, sourceTransactions, requiredDays })`:
- Walks `borrower_bank_transactions` for the connected accounts
- Confirms balance ≥ equityAmount maintained for `requiredDays` (default 90, configurable)
- Identifies any large deposits within the seasoning window — flags as "needs source-of-funds documentation"
- Returns `{ seasoned: boolean, balance_history: Array<{ date, balance }>, large_deposits: Array<{ date, amount, source_label }>, gaps: Array<{ type, message }> }`

#### E-2. `src/lib/sba/equitySeasoningService.ts`

Wraps the pure function with DB access:
- Pulls Plaid transactions for deal's connected accounts
- Calls `verifyEquitySeasoning`
- Emits `deal_gap_queue` entries for any `gaps` returned
- Updates `dealDataBuilder` derived field — add `equity_seasoning_verified: boolean`

#### E-3. Update `dealDataBuilder.ts`

Add `equity_seasoning_verified` derived field; reads from latest `borrower_bank_connections` + computed by `equitySeasoningService`.

This **fully closes the third leg of S1's Sources & Uses three-way tie-out** (S1 added the rule; S2 fixed the math; S4 verifies seasoning).

### F. Auto-built business debt schedule

#### F-1. `src/lib/financialFacts/debtScheduleAutoBuilder.ts`

Pure function `buildDebtSchedule(transactions: BorrowerBankTransaction[]): DebtScheduleEntry[]`:
- Filters transactions to `derived_category IN ('recurring_payment', 'mca', 'sba_loan_payment')`
- Groups by normalized merchant_name
- For each group: computes monthly payment (median of last 6 months), estimates outstanding balance (heuristic: `monthly_payment × 60` for unsecured, `× 240` for mortgage-shaped)
- Returns array of `{ creditor, monthly_payment, estimated_balance, account_type_inferred, confidence }`

Banker reviews + confirms via existing flow. Confirmed entries write to `deal_financial_facts` with `source_type='COMPUTED'`, `confidence: 0.7` (auto) or `1.0` (banker-confirmed).

DSCR computation already in place picks these up.

#### F-2. Tests

`src/lib/financialFacts/__tests__/debtScheduleAutoBuilder.test.ts` — 6 cases:
- Single mortgage transaction → single entry inferred as mortgage
- Multiple credit card payments same merchant → one entry, `account_type_inferred='credit_card'`
- MCA daily remittances → one entry, `account_type_inferred='mca'`
- Mixed transactions → all categorized
- Insufficient history (1 month only) → `confidence < 0.5`
- Empty transactions → empty array

### G. Remaining forms

Same module pattern as S2. Each at `src/lib/sba/forms/form{1920|912|155|159}/`:

#### G-1. Form 1920 — Lender's Application for Loan Guaranty
Required for every 7(a). Fields populated entirely from canonical state — banker-side form, no borrower fields. Sections A–U. Approximately 60 fields. Required for E-Tran submission.

#### G-2. Form 912 — Statement of Personal History
**Conditional generator:** only needed when Form 1919 Section II answers indicate criminal history triggers. `inputBuilder` reads `triggers_form_912` from latest Form 1919 build result. If false, generator returns `{ ok: true, applicable: false }` and the package builder skips it.

#### G-3. Form 155 — Standby Creditor's Agreement
**Conditional:** only needed when `seller_note_equity_portion > 0` from `deal_loan_requests`. Two signers: borrower + seller (the standby creditor). Both require IAL2 + e-sign per S3.

#### G-4. Form 159 — Fee Disclosure and Compensation Agreement
**Conditional:** only needed when an agent (broker, packager, accountant, etc.) was used. Banker indicates via `deal_loan_requests.agent_used` (new column — additive migration in A — TODO confirm column name; if not present, add additive migration `20260520_d_deal_loan_requests_agent_columns.sql`)

For each form: `fields.ts`, `build.ts`, `inputBuilder.ts`, `render.ts`, two API routes, `__tests__/build.test.ts`.

### H. Update package builder

#### H-1. `src/lib/sba/package/buildPackage.ts` — modify

Add new form codes to `resolvePackageItems`:
- FORM_1919 (always)
- FORM_413 (always, per 20%+ owner)
- FORM_1920 (always)
- FORM_912 (conditional on Form 1919 trigger)
- FORM_4506C (always per signer)
- FORM_155 (conditional on seller note as equity)
- FORM_159 (conditional on agent used)

Each form item references the generator + signing requirement.

#### H-2. Update Story tab `SbaSigningPanel` (S3)

Extend the per-form table to include all 7 forms. Display "Not applicable" for conditional forms when conditions not met.

---

## Tests required

| File | Coverage |
|---|---|
| `src/lib/integrations/creditBureau/__tests__/parser.test.ts` | 8 cases |
| `src/lib/integrations/creditBureau/__tests__/gapDetector.test.ts` | 7 cases (one per abnormality type + clean) |
| `src/lib/integrations/caivrs/__tests__/service.test.ts` | 4 cases |
| `src/lib/integrations/samGov/__tests__/client.test.ts` | 3 cases |
| `src/lib/integrations/irsTranscripts/__tests__/submission.test.ts` | 4 cases |
| `src/lib/integrations/irsTranscripts/__tests__/polling.test.ts` | 4 cases |
| `src/lib/integrations/irsTranscripts/__tests__/reconciler.test.ts` | 4 cases |
| `src/lib/sba/__tests__/equitySeasoning.test.ts` | 5 cases |
| `src/lib/financialFacts/__tests__/debtScheduleAutoBuilder.test.ts` | 6 cases |
| `src/lib/sba/forms/form1920/__tests__/build.test.ts` | 4 cases |
| `src/lib/sba/forms/form912/__tests__/build.test.ts` | 4 cases (incl. not-applicable case) |
| `src/lib/sba/forms/form4506c/__tests__/build.test.ts` | 4 cases |
| `src/lib/sba/forms/form155/__tests__/build.test.ts` | 3 cases |
| `src/lib/sba/forms/form159/__tests__/build.test.ts` | 3 cases |

Plus integration test: `src/__tests__/integration/sba-credit-pull-flow.test.ts` — full happy path: connect Plaid → request soft pull → tradelines persisted → abnormality detected → gap created.

---

## Environment variables

```
# Credit bureau
CREDIT_BUREAU_VENDOR=plaid_check
PLAID_CHECK_API_KEY=  # if separate from Plaid main

# CAIVRS
CAIVRS_API_BASE=
CAIVRS_AUTH_USERNAME=
CAIVRS_AUTH_PASSWORD=  # encrypted at rest

# SAM.gov (public; no key required for exclusions endpoint, but optional rate-limit-bypass key)
SAM_GOV_API_KEY=

# IRS transcripts
IRS_TRANSCRIPT_VENDOR=ncs  # or 'irs_direct' | 'idology' | 'wolters_kluwer' — set via PIV-3
IRS_VENDOR_API_KEY=
IRS_VENDOR_BASE_URL=

# Consent
CONSENT_TEMPLATE_VERSION=v1.0
```

Plus DocuSeal templates for new forms:
```
DOCUSEAL_TEMPLATE_FORM_1920=
DOCUSEAL_TEMPLATE_FORM_912=
DOCUSEAL_TEMPLATE_FORM_4506C=
DOCUSEAL_TEMPLATE_FORM_155=
DOCUSEAL_TEMPLATE_FORM_159=
```

---

## Verification (V-4)

**V-4a — Migrations applied**
```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public' AND table_name IN (
  'borrower_credit_pulls','borrower_credit_tradelines',
  'borrower_caivrs_checks','borrower_sam_exclusions',
  'borrower_irs_transcript_requests'
);
-- Expected: 5

-- Verify hard constraint on credit pulls
SELECT pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON c.conrelid=t.oid
WHERE t.relname='borrower_credit_pulls' AND c.conname LIKE '%pull_type%';
-- Expected: contains "CHECK (pull_type = 'soft')"
```

**V-4b — Soft pull end-to-end**
1. Connect Plaid for owner (S2)
2. POST `/api/deals/<test-deal>/credit-pull/request` with `ownership_entity_id`, consent fields
3. `borrower_credit_pulls.status='completed'`
4. `borrower_credit_tradelines` populated
5. Abnormalities (mock charge-off in test data) → `deal_gap_queue` rows created with `gap_type='credit_explanation'`

**V-4c — CAIVRS check**
- POST `/api/deals/<test-deal>/caivrs/run` → returns clear or hit
- `borrower_caivrs_checks` row written with `expires_at = now + 90d`
- `dealDataBuilder` returns `caivrs_checked=true, caivrs_hits=N` after check

**V-4d — SAM.gov check**
- POST `/api/deals/<test-deal>/sam/run` → public API hit, no errors
- For known-clean test entity → status='clear'

**V-4e — 4506-C generation + signing**
1. Form 4506-C build endpoint returns `is_complete=true` for fully-populated test deal
2. Render endpoint returns valid PDF
3. Request signature via S3 e-sign route → `IAL2_NOT_COMPLETED` if no IAL2; embed_url if IAL2 exists
4. After signing webhook fires → `signed_documents` row with `form_code='FORM_4506C'`
5. POST `/api/deals/<test-deal>/irs-transcripts/submit` with the `signed_4506c_id` → `borrower_irs_transcript_requests` row with `status='submitted'`

**V-4f — IRS polling**
Mock `next_poll_at < NOW()` on a submitted request → cron run picks it up, status updates per vendor mock response

**V-4g — Equity seasoning**
- Mock Plaid transactions showing $100K stable balance for 90+ days → `verifyEquitySeasoning` returns `seasoned=true`
- Mock $100K deposit 30 days ago → `seasoned=false` with gap "needs source-of-funds for $100K deposit on YYYY-MM-DD"

**V-4h — Debt schedule auto-builder**
- Mock Plaid transactions with mortgage + credit card + MCA → `buildDebtSchedule` returns 3 entries with appropriate `account_type_inferred`

**V-4i — Form 912 conditional**
- Form 1919 with `triggers_form_912=true` → Form 912 is required in package
- Form 1919 with all "no" answers → Form 912 returns `{ applicable: false }`, skipped from package

**V-4j — Form 155 conditional**
- Deal with `seller_note_equity_portion > 0` → Form 155 required
- Otherwise skipped

**V-4k — `tsc --noEmit` clean, `vitest run` clean, integration test passes**

**V-4l — GitHub API verification**
All spec'd files exist on `main`.

---

## Non-goals

- Hard credit pull (still and forever)
- Real-time IRS transcripts (async by IRS design)
- Custom credit-explanation UI (uses existing Story tab + Borrower Voice)
- Adverse-action notice generation (bank's responsibility, not Buddy's)
- Third-party orchestration — appraisal, valuation, Phase I (S5)
- Real E-Tran submission (S5)

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Soft-pull bureau vendor returns hard pull by mistake | Low | DB constraint `CHECK (pull_type = 'soft')` blocks insert; service layer asserts vendor request includes explicit soft flag |
| 2 | FCRA consent text not legally reviewed | Medium | PIV-4 gates on legal review; do not ship without approved text |
| 3 | CAIVRS access not yet provisioned for tenant | Medium | Per-tenant credentials in `banks.settings.caivrs_credentials` (encrypted); without credentials → `{ ok: false, reason: 'CAIVRS_CREDENTIALS_MISSING' }`, gap surfaced to banker |
| 4 | IRS vendor pick wrong, integration churn | Medium | PIV-3 surface step + Matt's pick before code; vendor abstraction in `client.ts` allows swap with isolated change |
| 5 | IRS transcripts arrive >14d post-submit (real-world rare but possible) | Medium | Polling cadence handles up to 14d; beyond that, surface as gap "transcripts delayed — banker may need to follow up directly" |
| 6 | SAM.gov API rate-limited | Low | Public endpoint allows ~200 req/day without key; with key (free) ~1000/day. Adequate for our volume |
| 7 | Plaid transactions don't cover full 90-day equity seasoning window for new accounts | Medium | If account opened <90d ago, surface "seasoning window incomplete — provide additional bank statements" gap |
| 8 | Auto-built debt schedule misses non-recurring debts | Medium | Banker reviews + confirms; existing manual debt-entry path remains. Auto-builder is suggestion, not authority |
| 9 | Form 912 / 155 / 159 templates change after we field them | Low | Same template_version pattern as S3; re-fielding is 1-day task |
| 10 | Pulse fastlane noise from new event types | Medium | New events: `credit_pull.completed`, `caivrs.check_completed`, `sam.check_completed`, `irs.transcript_submitted`, `irs.transcript_received`, `irs.reconciliation_completed`, `equity_seasoning.verified`, `debt_schedule.auto_built`. Each emits failure once until D3 ships |

---

## Hand-off commit message

```
spec(sba-30min-package/s4): soft-pull credit + CAIVRS + SAM + IRS 4506-C + remaining forms

- 5 new tables: credit_pulls + tradelines, caivrs_checks, sam_exclusions, irs_transcript_requests
- src/lib/integrations/creditBureau/: client + request + parser + gapDetector
- src/lib/integrations/caivrs/: client + service
- src/lib/integrations/samGov/: client + service
- src/lib/integrations/irsTranscripts/: client + submission + polling + reconciler
- src/lib/sba/equitySeasoning.ts + equitySeasoningService.ts
- src/lib/financialFacts/debtScheduleAutoBuilder.ts
- 5 new forms: 1920, 912 (conditional), 4506-C, 155 (conditional), 159 (conditional)
- 12+ test files; integration test
- dealDataBuilder updated with caivrs/sam/seasoning fields
- Package builder includes all 7 SBA forms

Verification: V-4a through V-4l
Spec: specs/sba-30min-package/SPEC-S4-credit-pull-and-irs.md
```

---

## Addendum for Claude Code

**Judgment boundaries:**

- PIV-3 vendor picks must be confirmed by Matt before integration code begins. Surface options + recommendation, wait for confirmation. Schema accommodates all options
- PIV-4 consent text legal review: blocking. Do not commit consent template without sign-off. If counsel review unavailable, surface; check in `public/consent-templates/` is acceptable as a draft only with `DRAFT` watermark
- IRS vendor v1: prefer NCS or IDology over IRS direct. IRS direct requires Designated User auth that takes 30+ days to provision. Surface if Matt prefers IRS direct
- Form 912 / 155 / 159 are conditional — invest field-mapping effort proportionally. Form 159 in particular is rare; ship a working draft and refine later
- IRS polling cron deployment optional in this sprint if time-constrained. Library function + tests are mandatory. Cron deployment can be follow-up
- **Hard credit pull guard:** the DB constraint AND service-layer assertion AND vendor-request flag must all be present. Three layers of defense. Any of them missing = surface and stop. This is a non-negotiable
- The "credit explanation" UI is the existing Story tab + Borrower Voice. **Do not build a new explanation UI.** If the existing infrastructure feels insufficient: surface, discuss, do not invent a parallel surface
- Equity seasoning relies on Plaid transactions from S2. If S2 sync hasn't run on the test deal, equity seasoning returns `{ ok: false, reason: 'PLAID_HISTORY_INSUFFICIENT' }` — appropriate; gap surfaces in Story tab

**Pulse fastlane:** new event types per risk #10 — D3 silence strongly recommended before/with this sprint.
