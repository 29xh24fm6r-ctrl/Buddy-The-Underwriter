# SPEC S1 — SOP 50 10 8 Rules + Critical Bug Fixes

**Date:** 2026-04-25 · **Owner:** Architecture (Matt) · **Executor:** Claude Code · **Effort:** 1–1.5 weeks · **Risk:** Low (additive migration; surgical bug fixes)

**Depends on:** Nothing · **Blocks:** S2, S3, S4, S5

---

## Background

The SBA eligibility engine in `src/lib/sba/eligibility.ts` is correctly shaped — rules-driven, JSON Logic conditions, severity tiers — but the rules data in `supabase/migrations/20251227000014_seed_sba_rules.sql` is keyed to **SOP 50 10 7(K)**. SOP 50 10 8 took effect June 1, 2025. Two procedural notices took effect March 1, 2026 (5000-875701 SBSS sunset; 5000-876626 citizenship/residency rewrite). Buddy is currently evaluating eligibility against rules that are 1–2 versions stale.

Two additional bugs in canonical paths produce wrong values today:

1. `src/lib/sba/sbaSourcesAndUses.ts` line ~110: `const minimumPct = isNewBusiness ? 0.2 : 0.1`. SOP 50 10 8 eliminated the 20% startup distinction — both startups and acquisitions are 10%. Every startup deal currently fails the equity gate at the wrong threshold.
2. `src/lib/etran/generator.ts` line ~123: `sba_guarantee_percentage: 75` hardcoded. Loans ≤$150K should be 85% per `sbaGuarantee.ts`. Inconsistent with the live calculator. E-Tran XML for every Small Loan would misstate the guarantee.

Plus the eligibility engine doesn't filter `sba_policy_rules` by `superseded_at IS NULL`. After this migration adds 22 SOP 50 10 8 rules and supersedes 10 old ones, queries that don't filter return both — producing contradictory evaluations.

## Build principles captured

**#11 — Regulatory rules ship as data, not code.** SOP changes are migrations. Eligibility logic in TypeScript stays stable across SOP versions.

**#12 — Sources & Uses must enforce all three checks.** Sources = Uses, equity ≥ minimum, seller note within standby + cap. Three-way tie-out, not two.

**#13 — Hardcoded SBA constants are forbidden.** All program-aware values (guarantee %, equity %, DSCR thresholds) route through `sbaGuarantee.ts` or `sba_policy_rules`. Never inline.

---

## Pre-implementation verification (PIV)

Run before writing any code. Each must pass.

### PIV-1 — Confirm `sba_policy_rules` schema
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='sba_policy_rules'
ORDER BY ordinal_position;
```
Expected columns include: `id, program, rule_key, category, condition_json, title, explanation, borrower_friendly_explanation, fix_suggestions, sop_reference, severity, created_at`. **If `policy_version` already exists, this spec's migration must be adjusted to be idempotent — the `ADD COLUMN IF NOT EXISTS` form already handles this.**

### PIV-2 — Confirm 10 stale rules present
```sql
SELECT count(*) FROM public.sba_policy_rules WHERE sop_reference LIKE '%50 10 7%';
-- Expected: 10 (per migration 20251227000014)
```

### PIV-3 — Confirm `evaluateSBAEligibility` query shape
View `src/lib/sba/eligibility.ts`. The current query is:
```ts
const { data: rules } = await sb
  .from("sba_policy_rules")
  .select("*")
  .or(`program.eq.${program},program.eq.BOTH`)
  .order("severity", { ascending: false });
```
**Confirm there is NO `superseded_at` filter today.** Adding the filter is a required change in this spec.

### PIV-4 — Confirm Sources & Uses bug present
```sh
grep -n "isNewBusiness ? 0.2 : 0.1" src/lib/sba/sbaSourcesAndUses.ts
```
Expected: one match around line 110.

### PIV-5 — Confirm E-Tran guarantee bug present
```sh
grep -n "sba_guarantee_percentage: 75" src/lib/etran/generator.ts
```
Expected: one match around line 123.

### PIV-6 — Confirm `sbaGuarantee.ts` correct
```sh
grep -n "loanAmount <= 150_000" src/lib/sba/sbaGuarantee.ts
```
Expected: at least one match. This is the function we'll route the e-Tran fix through.

---

## What's in scope

### A. Schema migration — add policy versioning to `sba_policy_rules`

`supabase/migrations/20260428_seed_sba_rules_50108.sql`

```sql
BEGIN;

-- Add versioning columns
ALTER TABLE public.sba_policy_rules
  ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'SOP_50_10_7K',
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by_rule_id uuid REFERENCES public.sba_policy_rules(id);

CREATE INDEX IF NOT EXISTS idx_sba_policy_rules_active
  ON public.sba_policy_rules(program, policy_version)
  WHERE superseded_at IS NULL;

-- Stamp existing 50 10 7(K) rules as superseded
UPDATE public.sba_policy_rules
  SET superseded_at = NOW(),
      policy_version = 'SOP_50_10_7K'
  WHERE policy_version = 'SOP_50_10_7K'
    AND superseded_at IS NULL;

-- 22 new SOP 50 10 8 rules inserted below.
-- Pattern repeats; full SQL in B-1 below.

COMMIT;
```

### B-1. Rule inventory — 22 rules to insert

Each rule has `policy_version='SOP_50_10_8'` + appropriate `effective_date` + `superseded_at=NULL`. Severity column in parentheses. Field name in `condition_json` listed for cross-ref to S2 deal-data builder.

| # | rule_key | Severity | SOP / Notice ref | Field(s) referenced |
|---|---|---|---|---|
| 1 | `ELIGIBILITY.CITIZENSHIP_100_PCT` | HARD_STOP | PN 5000-876626 | `all_owners_citizenship_eligible` |
| 2 | `ELIGIBILITY.OWNERSHIP_LOOKBACK_6MO` | HARD_STOP | SOP 50 10 8 §A Ch.2 | `ineligible_owner_in_lookback_window` |
| 3 | `ELIGIBILITY.CAIVRS_CLEAR` | HARD_STOP | SOP 50 10 8 §A Ch.2 + §B Ch.1 | `caivrs_checked`, `caivrs_hits` |
| 4 | `ELIGIBILITY.NO_PRIOR_SBA_LOSS` | HARD_STOP | SOP 50 10 8 §A Ch.2 | `borrower_has_prior_sba_loss` |
| 5 | `USE_OF_PROCEEDS.NO_MCA_REFI` | HARD_STOP | SOP 50 10 8 §B Ch.1 | `use_of_proceeds_includes_mca_refi` |
| 6 | `USE_OF_PROCEEDS.WC_50_PCT_TRIGGERS` | REQUIRES_MITIGATION | SOP 50 10 8 §B Ch.1+4 | `working_capital_pct_of_proceeds`, `working_capital_justification_present`, `lien_on_all_fixed_assets_planned` |
| 7 | `EQUITY.SELLER_NOTE_STANDBY_AND_CAP` | HARD_STOP | SOP 50 10 8 §B Ch.2 | `seller_note_used_for_equity`, `seller_note_full_standby_for_loan_term`, `seller_note_pct_of_equity` |
| 8 | `COB.RETAINING_SELLER_2YR_GUARANTEE` | HARD_STOP | SOP 50 10 8 §B Ch.2 | `retaining_seller_present`, `retaining_seller_guarantees_2yr` |
| 9 | `COB.SINGLE_TRANSACTION_REQUIRED` | HARD_STOP | SOP 50 10 8 §B Ch.2 | `cob_is_single_transaction` |
| 10 | `COB.PARTIAL_MUST_BE_STOCK` | HARD_STOP | SOP 50 10 8 §B Ch.2 | `is_partial_cob`, `cob_transaction_type` |
| 11 | `FRANCHISE.DIRECTORY_LISTED_AND_CERTIFIED` | HARD_STOP | SOP 50 10 8 §A Ch.2 + PN 5000-871010 | `is_franchise_deal`, `franchise_brand_on_directory`, `franchise_brand_certified_or_pre_deadline` |
| 12 | `INSURANCE.HAZARD_REQUIRED` | REQUIRES_MITIGATION | SOP 50 10 8 §B Ch.4 | `loan_amount`, `hazard_insurance_replacement_cost_present` |
| 13 | `INSURANCE.LIFE_REQUIRED_CONDITIONAL` | REQUIRES_MITIGATION | SOP 50 10 8 §B Ch.4 | `loan_amount`, `is_single_owner_business`, `loan_fully_secured_by_hard_collateral`, `key_person_life_insurance_present` |
| 14 | `DOCS.TAX_TRANSCRIPT_VERIFICATION` | HARD_STOP | SOP 50 10 8 §A Ch.5 + §B Ch.1 | `form_4506c_signed`, `tax_transcripts_received_or_pending` |
| 15 | `SCREENING.SBSS_NOT_USED_BY_FEDERAL_LENDERS` | HARD_STOP | PN 5000-875701 | `lender_is_federally_regulated`, `screening_uses_sbss` |
| 16 | `FINANCIAL.DSCR_PROGRAM_AWARE` | REQUIRES_MITIGATION | SOP 50 10 8 §B Ch.1 | `is_7a_small_loan`, `is_acquisition`, `dscr` |
| 17 | `FINANCIAL.EQUITY_INJECTION_10_PCT` | HARD_STOP | SOP 50 10 8 §B Ch.2 | `equity_injection_pct_of_project` |
| 18 | `ADVISORY.BUSINESS_AGE_2YR` | ADVISORY | SOP 50 10 8 §B Ch.1 | `business_age_years` |
| 19 | `PROGRAM.SMALL_LOAN_MAX_350K` | HARD_STOP | SOP 50 10 8 §B Ch.1 | `is_7a_small_loan`, `loan_amount` |
| 20 | `COLLATERAL.PERSONAL_RE_25PCT_EQUITY` | REQUIRES_MITIGATION | SOP 50 10 8 §B Ch.4 | `loan_amount`, `loan_fully_secured_by_business_assets`, `personal_re_collateral_decision_documented` |
| 21 | `FINANCIAL.SOURCES_USES_BALANCED` | HARD_STOP | SOP 50 10 8 §B Ch.1 | `sources_uses_imbalance_abs` |
| 22 | `ELIGIBILITY.CREDIT_ELSEWHERE_50108` | HARD_STOP | SOP 50 10 8 §A Ch.5 | `credit_elsewhere_test_documented`, `credit_elsewhere_finding` |

**Full INSERT statements** for all 22 rules: see appendix in this spec file's git history (initial commit will include them inline). Each follows the existing migration 20251227000014 pattern with the additional columns `policy_version='SOP_50_10_8'` and `effective_date` set to either `'2025-06-01'` (SOP 50 10 8 effective date) or `'2026-03-01'` (procedural notice effective date for rules 1, 2, 15).

> **Note for executor:** The 22 rule INSERT bodies are mechanical — same shape as the existing 10 rules in `20251227000014_seed_sba_rules.sql`. Use that file as the template; for each rule above, populate `condition_json` per the field references column, write `title`, `explanation`, `borrower_friendly_explanation`, and 1–3 `fix_suggestions`. Review draft against SOP 50 10 8 PDF before commit. The exact prose may evolve; **do not block on prose perfection** — the contract is the rule_key + condition_json + severity + sop_reference + policy_version.

### B-2. Critical eligibility engine fix

`src/lib/sba/eligibility.ts` — modify `evaluateSBAEligibility`:

Find:
```ts
const { data: rules } = await sb
  .from("sba_policy_rules")
  .select("*")
  .or(`program.eq.${program},program.eq.BOTH`)
  .order("severity", { ascending: false });
```

Replace with:
```ts
const { data: rules } = await sb
  .from("sba_policy_rules")
  .select("*")
  .or(`program.eq.${program},program.eq.BOTH`)
  .is("superseded_at", null)
  .order("severity", { ascending: false });
```

**This change is non-optional and must ship in the same PR as the migration.** Without it the engine evaluates against both 50 10 7(K) and 50 10 8 rules and produces contradictory results.

### C. Sources & Uses fix + seller note enforcement

`src/lib/sba/sbaSourcesAndUses.ts` — surgical changes:

**C-1.** Update `BuildSourcesAndUsesInput` type — add `sellerNoteEquityPortion: number` and `sellerNoteFullStandby: boolean`. Keep `isNewBusiness` for backward compat but mark `@deprecated` in JSDoc.

**C-2.** Update `EquityInjectionCheck` type — add `sellerNoteCheck` sub-object:
```ts
sellerNoteCheck: {
  sellerNoteAmount: number;
  sellerNotePctOfEquity: number;
  fullStandbyConfirmed: boolean;
  passes: boolean;
  failureReason: string | null;
}
```

**C-3.** In `buildSourcesAndUses` — replace the `minimumPct` calculation:
```ts
// SOP 50 10 8 sets equity injection minimum at 10% for both startups and
// complete changes of ownership. Pre-2021 distinction (20% vs 10%) eliminated.
const minimumPct = 0.10;
```

**C-4.** After existing equity passes/fails computation, add seller-note check:
```ts
const sellerNoteAmount = Math.max(0, input.sellerNoteEquityPortion ?? 0);
const sellerNotePctOfEquity =
  equityInjectionAmount > 0 ? sellerNoteAmount / equityInjectionAmount : 0;
const sellerNoteWithinCap = sellerNotePctOfEquity <= 0.50;
const sellerNoteStandbyOK =
  sellerNoteAmount === 0 || (input.sellerNoteFullStandby ?? false);
const sellerNotePasses = sellerNoteWithinCap && sellerNoteStandbyOK;

let sellerNoteFailureReason: string | null = null;
if (!sellerNoteWithinCap) {
  sellerNoteFailureReason =
    `Seller note ($${sellerNoteAmount.toLocaleString()}) exceeds 50% of equity ` +
    `injection ($${equityInjectionAmount.toLocaleString()}).`;
} else if (!sellerNoteStandbyOK) {
  sellerNoteFailureReason =
    `Seller note used as equity must be on full standby for the SBA loan term.`;
}

const passesAll = passesMinimum && sellerNotePasses;
```

**C-5.** Update returned `equityInjection` object — replace `passes: passes` with `passes: passesAll` and add the `sellerNoteCheck` field.

### D. E-Tran guarantee fix

`src/lib/etran/generator.ts` — surgical changes:

**D-1.** Add import at top:
```ts
import { calculateSBAGuarantee, detectSBAProgram } from "@/lib/sba/sbaGuarantee";
```

**D-2.** In `mapTruthToETran`, replace:
```ts
sba_guarantee_percentage: 75, // Standard 7(a) guarantee
```
With:
```ts
sba_guarantee_percentage: (() => {
  const program = detectSBAProgram(truth.loan?.deal_type ?? "sba_7a");
  const result = calculateSBAGuarantee(truth.loan?.amount ?? 0, program);
  return Math.round(result.guaranteePct * 100);
})(),
```

### E. SOP citation registry refresh

`src/lib/sba/sopRules.ts` — replace entire file. Currently references SOP 50 10 6(B). Replace with SOP 50 10 8 + procedural notices. New content:

```ts
/**
 * SOP citation registry — current as of SOP 50 10 8 (effective June 1, 2025)
 * + Procedural Notice 5000-875701 (SBSS sunset, March 1, 2026)
 * + Procedural Notice 5000-876626 (citizenship/residency, March 1, 2026).
 *
 * For per-rule citations see sba_policy_rules.sop_reference column.
 */
export const SOP_VERSION = "SOP_50_10_8" as const;
export const SOP_EFFECTIVE_DATE = "2025-06-01" as const;

export const PROCEDURAL_NOTICES = {
  SBSS_SUNSET: { notice_number: "5000-875701", effective_date: "2026-03-01",
    title: "SBSS Sunset for Federally Regulated Lenders" },
  CITIZENSHIP_RESIDENCY: { notice_number: "5000-876626", effective_date: "2026-03-01",
    title: "100% U.S. Citizen / LPR / U.S. National Ownership" },
  FRANCHISE_CERTIFICATION_DEADLINE: { deadline: "2026-06-30",
    note: "Brands listed as of May 2023 must complete SBA Franchisor Certification by this date." },
} as const;

export const SOP_RULES = {
  ELIGIBILITY: { id: "SOP_50_10_8_A2",
    description: "For-profit small business meeting size standards",
    citation: "SOP 50 10 8 §A Ch.2" },
  CASH_FLOW: { id: "SOP_50_10_8_B1",
    description: "Cash flow supports debt service per program-specific DSCR minimums",
    citation: "SOP 50 10 8 §B Ch.1" },
  EQUITY_INJECTION: { id: "SOP_50_10_8_B2_EQUITY",
    description: "10% equity of total project cost; seller note ≤50% of equity if full standby",
    citation: "SOP 50 10 8 §B Ch.2" },
  COLLATERAL: { id: "SOP_50_10_8_B4",
    description: "Required to extent available; specific haircuts in fully-secured calc",
    citation: "SOP 50 10 8 §B Ch.4" },
  CITIZENSHIP: { id: "PN_5000_876626",
    description: "100% U.S. citizen / LPR / U.S. National ownership",
    citation: "Procedural Notice 5000-876626 (2026-03-01)" },
  SBSS_SUNSET: { id: "PN_5000_875701",
    description: "SBSS not permitted for federally-regulated lenders on 7(a) Small Loans",
    citation: "Procedural Notice 5000-875701 (2026-03-01)" },
} as const;
```

---

## Tests required

### `src/lib/sba/__tests__/sopRules.test.ts`
- Asserts `SOP_VERSION === "SOP_50_10_8"`
- Asserts both procedural notices present with correct numbers
- Asserts franchise deadline = `"2026-06-30"`
- Asserts every `SOP_RULES.*.citation` matches `/SOP 50 10 8|Procedural Notice/`

### `src/lib/sba/__tests__/sbaSourcesAndUses.test.ts` (append)
Five cases:
- Startup with exactly 10% equity passes (`minimumPct === 0.10`)
- Seller note exactly 50% of equity, full standby → passes
- Seller note 60% of equity → fails with "exceeds 50%" reason
- Seller note 30% of equity, no full standby → fails with "full standby" reason
- Sources = Uses within $1 → balanced

### `src/lib/etran/__tests__/generator.test.ts`
Three cases:
- $120K loan, `deal_type='sba_7a'` → guarantee = 85
- $400K loan, `deal_type='sba_7a'` → guarantee = 75
- $300K loan, `deal_type='sba_7a_export_express'` → guarantee = 90

---

## Verification (V-1)

Run after migration applies and code merges. Each must return expected.

**V-1a — 22 active SOP 50 10 8 rules**
```sql
SELECT count(*) FROM sba_policy_rules
WHERE policy_version = 'SOP_50_10_8' AND superseded_at IS NULL;
-- Expected: 22
```

**V-1b — 10 superseded 50 10 7(K) rules**
```sql
SELECT count(*) FROM sba_policy_rules
WHERE policy_version = 'SOP_50_10_7K' AND superseded_at IS NOT NULL;
-- Expected: 10
```

**V-1c — eligibility engine filters correctly**
On Samaritus deal `d65cc19e-b03e-4f2d-89ce-95ee69472cf3`, run `evaluateSBAEligibility`. Inspect returned `report.passed_rules` + `report.hard_stops` + `report.mitigations_required` — total count must equal 22 (or fewer if some rules are program-filtered to 504 only). **Must not see any rule_key from the old 50 10 7(K) set.**

**V-1d — Sources & Uses startup minimum**
```ts
buildSourcesAndUses({ loanAmount: 900_000, equityInjectionAmount: 100_000,
  equityInjectionSource: "cash_savings", sellerNoteEquityPortion: 0,
  sellerNoteFullStandby: false, sellerFinancingAmount: 0, otherSources: [],
  useOfProceeds: [{ category: "wc", description: "wc", amount: 1_000_000 }],
  isNewBusiness: true });
// .equityInjection.passes === true
// .equityInjection.minimumPct === 0.10
```

**V-1e — E-Tran guarantee correct for Small Loan**
Render e-Tran XML for hypothetical deal with `loan_amount=120000, deal_type='sba_7a'`. XML output contains `<SBAGuaranteePercentage>85</SBAGuaranteePercentage>`.

**V-1f — `tsc --noEmit` clean, `vitest run` clean**

**V-1g — GitHub API verification**
```ts
github_read_file({ path: "supabase/migrations/20260428_seed_sba_rules_50108.sql", ref: "main" })
github_read_file({ path: "src/lib/sba/sopRules.ts", ref: "main" })
github_read_file({ path: "src/lib/sba/sbaSourcesAndUses.ts", ref: "main" })
github_read_file({ path: "src/lib/etran/generator.ts", ref: "main" })
github_read_file({ path: "src/lib/sba/eligibility.ts", ref: "main" })
```
Each must return content matching this spec. `eligibility.ts` must contain `.is("superseded_at", null)`. `sbaSourcesAndUses.ts` must contain `const minimumPct = 0.10;`. `generator.ts` must contain `calculateSBAGuarantee(`.

---

## Non-goals

- New deal-data builder service (S2 — populates the new rule fields like `is_7a_small_loan`, `caivrs_hits`, `equity_injection_pct_of_project`)
- New API routes (S2 wires the eligibility engine to a route)
- CAIVRS / SAM.gov / Plaid integration (S4)
- E-sign or KYC (S3)
- Form generators (S2)
- E-Tran submission (S5 — only fixing the guarantee % bug here)

The 22 new rules will mostly evaluate as "data not yet available" until S2 ships the deal-data builder. That's expected — the rule engine returns `passes: false` with `field_values` showing nulls. The Story tab gap-resolution flow will surface them as gaps for borrower input.

---

## Risk register

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Migration fails on existing test data | Low | Purely additive; supersession is metadata stamp |
| 2 | Existing eligibility evaluations break because callers don't filter `superseded_at` | **High** before fix; **None** after | B-2 fix is mandatory in same PR |
| 3 | New rule field names don't exist in deal data passed to evaluator | High | Field lookup defaults to undefined; rule fails closed; surfaced as "field not yet computed". S2 builds the data layer |
| 4 | Tests for `sbaSourcesAndUses` fail because callers don't pass new input fields | High | Audit callers via grep before PR; add default values at each call site as part of this PR |
| 5 | Prose in 22 rule entries imperfect | Medium | Ship with reasonable prose; refine in follow-up. The contract is rule_key + condition_json + severity, not the prose |

**Caller audit for risk #4:**
```sh
grep -rn "buildSourcesAndUses(" src/
```
Every call site must pass `sellerNoteEquityPortion: 0` and `sellerNoteFullStandby: false` if not otherwise computed. Acceptable defaults preserve existing behavior.

---

## Hand-off commit message

```
spec(sba-30min-package/s1): SOP 50 10 8 rules + critical bugfixes

- Migration 20260428: adds policy_version, supersedes 10 stale rules,
  inserts 22 SOP 50 10 8 rules
- eligibility.ts: filter to superseded_at IS NULL (mandatory)
- sbaSourcesAndUses.ts: equity minimum 10% (was 20% for startups);
  seller note enforcement (≤50% of equity, full standby for loan term)
- etran/generator.ts: route guarantee % through calculateSBAGuarantee
  (fixes hardcoded 75% bug)
- sopRules.ts: refresh citations to SOP 50 10 8 + March 2026 notices
- Tests: sopRules, sbaSourcesAndUses (5 cases), generator (3 cases)

Verification: V-1a through V-1g
Spec: specs/sba-30min-package/SPEC-S1-rules-and-bugfixes.md
```

---

## Addendum for Claude Code

**Judgment boundaries — when to stop and surface:**

- If PIV-1 reveals `policy_version` already exists with a non-default value → stop. Different prior intent. Surface before proceeding.
- If PIV-2 returns ≠ 10 → stop. Migration history different from spec assumption. Surface.
- If PIV-3 reveals the eligibility query has been changed since spec drafting → stop. Adapt the change in B-2 to the current shape; surface for confirmation before commit.
- If grep in PIV-4 or PIV-5 returns 0 matches → the bug was already fixed. Skip C/D for that bug. Surface.
- If `buildSourcesAndUses` callers (risk #4) include an interface that's deeply embedded in cockpit components → don't refactor cockpit components. Add default values at the immediate call boundary only. Surface if a deeper change appears necessary.

**What to write the 22 rule INSERTs against:** use the existing `20251227000014_seed_sba_rules.sql` as the structural template. For prose (`title`, `explanation`, `borrower_friendly_explanation`, `fix_suggestions`), draft on best understanding of SOP 50 10 8; do not block on perfect prose. The contract that matters is `rule_key`, `condition_json`, `severity`, `sop_reference`, `policy_version`, `effective_date`.

**Pulse fastlane:** D3 still queued. New event types don't apply in this sprint (no new events added). No fastlane noise increase.
