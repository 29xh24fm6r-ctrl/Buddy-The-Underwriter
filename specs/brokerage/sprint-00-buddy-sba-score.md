# Sprint 0 — Buddy SBA Score

**Status:** Specification — ready for implementation
**Depends on:** prereq-concierge-gemini-migration
**Blocks:** Sprints 1, 4, 5, 6 (tenant, LMA, sealing, marketplace all reference the score)
**References:** [brokerage-master-plan.md](./brokerage-master-plan.md) §7

---

## Purpose

Build the Buddy SBA Score — a deterministic 0–100 composite that lenders see on every marketplace listing, that drives the rate card, and that serves as the trust language between borrower, Buddy, and lender. Without it, the marketplace has no vocabulary; every sprint after this references it.

The score is **not a credit decision**. It is a compliance-and-strength summary that tells a matched lender "this deal passes SOP 50 10 7.1 eligibility and ranks at this strength level within Buddy's curated pool." Lenders still apply their own credit box.

---

## Foundation — what's already built

`src/lib/sba/sbaRiskProfile.ts` already produces a 4-factor weighted risk score on a 1–5 scale, persisted to `buddy_sba_risk_profiles`:

- Industry default rate (40% weight) — via `getSBAIndustryDefaultProfile`, backed by SBA national loan database 1987–2014 (~899K loans)
- Business age (35%) — via `assessNewBusinessRisk` + `detectNewBusinessFromFacts`
- Loan term (15%) — `assessLoanTermRisk` bucketed 3/7/15-year bands
- Urban/rural (10%) — simple tier

All factors carry tier, narrative, source, SR 11-7 explainability. **This is roughly 30-40% of the final score coverage.** Sprint 0 extends, not replaces.

---

## Target shape

### Components and weights

```
Buddy SBA Score = 100 × weighted_sum(component_scores / 5)

Pre-gate (hard):
  SOP 50 10 7.1 eligibility — pass/fail. FAIL → score = 0, deal cannot list.

Components (each 0–5, higher is better):

1. Borrower strength         25%
   - FICO band                       (40% of component)
   - Liquidity relative to injection (20%)
   - Net worth relative to loan      (15%)
   - Industry experience years       (15%)
   - Management depth                (10%)

2. Business strength         20%
   - Years in business / franchise maturity  (40% of component)
   - Industry default rate tier              (30%) — reuses existing factor
   - Feasibility overall score               (30%)

3. Deal structure            15%
   - Equity injection %              (40% of component)
   - Loan-to-project ratio           (30%)
   - Collateral coverage ratio       (20%)
   - SBA guaranty coverage           (10%)

4. Repayment capacity        30%
   - Base DSCR                       (35% of component)
   - Stress DSCR                     (25%)
   - Projected-vs-historical variance (15%)
   - Global cash flow DSCR           (15%)
   - Loan term risk tier             (10%) — reuses existing factor

5. Franchise quality         10% (when applicable; re-distributed when not)
   - SBA Franchise Directory status    (35% of component)
   - FDD Item 19 unit economics tier   (30%)
   - Brand maturity (open unit count)  (20%)
   - Franchisor support strength       (15%)
```

**Non-franchise deals:** the 10% franchise weight redistributes proportionally into the other four components (borrower 28%, business 22%, structure 17%, repayment 33%).

**Score bands:**

| Band | Range | Meaning | Rate card tier |
|---|---|---|---|
| Institutional prime | 90–100 | All components strong | best rate tier |
| Strong fit | 80–89 | Minor weaknesses only | standard tier |
| Selective fit | 70–79 | Real but manageable weaknesses | widened-spread tier |
| Specialty lender | 60–69 | Needs specialty lender appetite | widest tier |
| Not marketplace-eligible | <60 | Too weak for curated pool | manual review only |

### Output shape

```typescript
export type BuddySBAScore = {
  dealId: string;
  computedAt: string;
  scoreVersion: string;              // "1.0.0" on launch

  // Hard gate
  eligibilityPassed: boolean;
  eligibilityFailures: string[];     // empty if passed

  // Composite
  score: number;                     // 0–100
  band: "institutional_prime" | "strong_fit" | "selective_fit" |
        "specialty_lender" | "not_eligible";
  rateCardTier: "best" | "standard" | "widened" | "widest" | null;

  // Components
  borrowerStrength: ComponentScore;
  businessStrength: ComponentScore;
  dealStructure: ComponentScore;
  repaymentCapacity: ComponentScore;
  franchiseQuality: ComponentScore | null;  // null for non-franchise

  // Explainability
  narrative: string;                 // 2-3 paragraphs plain English
  topStrengths: string[];            // 3 bullet points
  topWeaknesses: string[];           // 3 bullet points, can be empty

  // Metadata
  inputSnapshot: Record<string, unknown>;  // all inputs used, for reproducibility
  weightsSnapshot: Record<string, number>; // weights used, for audit
};

export type ComponentScore = {
  componentName: string;
  rawScore: number;                  // 0–5
  weight: number;                    // 0–1
  contribution: number;              // rawScore * weight * 20 (pct contribution to total)
  subFactors: SubFactorScore[];
  narrative: string;
  missingInputs: string[];           // empty if all sub-factors scored
};

export type SubFactorScore = {
  name: string;
  rawScore: number;                  // 0–5
  weight: number;                    // 0–1 within component
  value: string | number | null;     // the actual input value
  source: string;                    // e.g. "borrower_applications.fico_score"
  narrative: string;
};
```

### Missing input handling

If a sub-factor's input is missing (e.g., FICO not yet collected), the sub-factor scores as `null` and does not contribute. The component re-normalizes weights across available sub-factors.

If more than 50% of a component's weight is missing inputs, the component is marked `insufficient_data` and the deal cannot list yet (surfaces as a gap in the concierge queue).

---

## Database

### Migration: `supabase/migrations/20260424_buddy_sba_score.sql`

```sql
-- ============================================================================
-- Sprint 0: Buddy SBA Score
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.buddy_sba_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  score_version text NOT NULL,          -- semver, e.g. "1.0.0"

  eligibility_passed boolean NOT NULL,
  eligibility_failures jsonb NOT NULL DEFAULT '[]'::jsonb,

  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band text NOT NULL CHECK (band IN (
    'institutional_prime','strong_fit','selective_fit',
    'specialty_lender','not_eligible'
  )),
  rate_card_tier text CHECK (rate_card_tier IN ('best','standard','widened','widest')),

  borrower_strength jsonb NOT NULL,
  business_strength jsonb NOT NULL,
  deal_structure jsonb NOT NULL,
  repayment_capacity jsonb NOT NULL,
  franchise_quality jsonb,              -- null for non-franchise

  narrative text NOT NULL,
  top_strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,

  input_snapshot jsonb NOT NULL,        -- full inputs for reproducibility
  weights_snapshot jsonb NOT NULL,      -- weights used, for audit

  computed_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,            -- when a newer score replaces this one

  UNIQUE (deal_id, computed_at)
);

CREATE INDEX buddy_sba_scores_deal_id_idx ON public.buddy_sba_scores (deal_id);
CREATE INDEX buddy_sba_scores_bank_id_idx ON public.buddy_sba_scores (bank_id);
CREATE INDEX buddy_sba_scores_band_idx ON public.buddy_sba_scores (band);
CREATE INDEX buddy_sba_scores_score_idx ON public.buddy_sba_scores (score);

-- Most-recent score per deal (convenience view)
CREATE OR REPLACE VIEW public.buddy_sba_scores_latest AS
SELECT DISTINCT ON (deal_id) *
FROM public.buddy_sba_scores
WHERE superseded_at IS NULL
ORDER BY deal_id, computed_at DESC;

-- RLS mirrors deals: bank members see their own tenant's scores.
ALTER TABLE public.buddy_sba_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY buddy_sba_scores_select_for_bank_members
  ON public.buddy_sba_scores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_sba_scores.bank_id AND m.user_id = auth.uid()
  ));

CREATE POLICY buddy_sba_scores_insert_for_bank_members
  ON public.buddy_sba_scores FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_sba_scores.bank_id AND m.user_id = auth.uid()
  ));
```

### Verification queries (run after migration)

```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'buddy_sba_scores';
-- Expect: true

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'buddy_sba_scores'
ORDER BY ordinal_position;
-- Expect: id, deal_id, bank_id, score_version, eligibility_passed, ...
```

---

## Code

### New module: `src/lib/score/buddySbaScore.ts`

Main entry point:

```typescript
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSBARiskProfile } from "@/lib/sba/sbaRiskProfile";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
// ...

export const SCORE_VERSION = "1.0.0";

export async function computeBuddySBAScore(params: {
  dealId: string;
  sb: SupabaseClient;
}): Promise<BuddySBAScore> {
  // 1. Load inputs from deal + related tables (see input sources below)
  // 2. Run SOP 50 10 7.1 eligibility gate (eligibilityEngine)
  //    - If fail → return score=0, band='not_eligible', eligibility_failures populated
  // 3. Compute each component:
  //    - Borrower strength
  //    - Business strength  (reuses sbaRiskProfile.industryFactor)
  //    - Deal structure
  //    - Repayment capacity (reuses sbaRiskProfile.loanTermFactor)
  //    - Franchise quality  (if franchise_brand_id present)
  // 4. Apply weights (franchise-redistributed if non-franchise)
  // 5. Compute composite, band, rate_card_tier
  // 6. Generate narrative + top strengths + top weaknesses (deterministic templated prose)
  // 7. Persist to buddy_sba_scores with superseded_at flag on prior row
  // 8. Return full BuddySBAScore
}
```

### Sub-factor scoring functions

Each sub-factor gets its own pure function with a scoring curve. Examples:

```typescript
function scoreFicoBand(fico: number | null): SubFactorScore {
  if (fico == null) return nullSubFactor("fico_band", "FICO not provided");
  const raw =
    fico >= 760 ? 5 :
    fico >= 720 ? 4 :
    fico >= 680 ? 3 :
    fico >= 640 ? 2 : 1;
  return {
    name: "fico_band",
    rawScore: raw,
    weight: 0.40,
    value: fico,
    source: "borrower_applications.fico_score",
    narrative: `FICO ${fico} is in the ${ficoBandLabel(fico)} band.`,
  };
}

function scoreEquityInjectionPct(pct: number | null): SubFactorScore {
  if (pct == null) return nullSubFactor("equity_injection_pct", "Equity injection not set");
  const raw =
    pct >= 0.25 ? 5 :   // 25%+ — well above SBA floor of 10%
    pct >= 0.15 ? 4 :
    pct >= 0.10 ? 3 :
    pct >= 0.05 ? 2 : 1;
  return { /* ... */ };
}

function scoreBaseDSCR(dscr: number | null): SubFactorScore {
  if (dscr == null) return nullSubFactor("base_dscr", "DSCR not computed");
  const raw =
    dscr >= 1.60 ? 5 :
    dscr >= 1.40 ? 4 :
    dscr >= 1.25 ? 3 :  // SBA floor
    dscr >= 1.15 ? 2 : 1;
  return { /* ... */ };
}
```

All scoring curves live in `src/lib/score/scoringCurves.ts` so they can be tuned in one place as data comes in.

### Narrative generation

Deterministic templated prose — NO LLM. The narrative has three parts:

```typescript
function buildScoreNarrative(score: BuddySBAScore): string {
  return [
    summarizeBand(score.band, score.score),
    summarizeComponentHighlights(score),
    summarizeStandoutFactor(score),
  ].join("\n\n");
}
```

Example output for an 84-scoring deal:

> This deal scores 84 on the Buddy SBA Score, placing it in the Strong Fit band. Deals in this band typically match most participating lenders' credit boxes with minor underwriting conditions.
>
> The strongest component is repayment capacity (4.3/5), driven by a base DSCR of 1.48x and a stress DSCR of 1.21x. Borrower strength scores 4.0/5 on a FICO of 742 and 11 years of direct industry experience. Deal structure is acceptable at 3.5/5 with 15% equity injection. Business strength is 3.8/5.
>
> The primary weakness is short business tenure (8 months), partially offset by borrower industry experience and a complete feasibility study.

### Explainability exports

`getScoreExplainability(scoreId)` returns every sub-factor with source citation, letting a lender or auditor trace exactly how the score was computed. This is the SR 11-7 evidence file.

---

## Input sources

Every sub-factor input must resolve to a specific table and column:

| Sub-factor | Source |
|---|---|
| FICO band | `borrower_applications.fico_score` |
| Liquidity | `borrower_applications.liquid_assets` + `buddy_sba_assumptions.loan_impact` |
| Net worth | `borrower_applications.net_worth` + `deals.loan_amount` |
| Industry experience years | `deal_ownership_entities` (max of owners' industry_years) |
| Management depth | `buddy_sba_assumptions.management_team` (count + avg years) |
| Years in business | `deal_financial_facts[fact_key='YEARS_IN_BUSINESS']` |
| Industry default tier | existing `sbaRiskProfile.industryFactor` |
| Feasibility score | `buddy_feasibility_reports.overall_score` |
| Equity injection % | `buddy_sba_packages.sources_and_uses.equityInjection.actualPct` |
| Loan-to-project ratio | derived from `sources_and_uses` |
| Collateral coverage | `deal_collateral_items.estimated_value` / `deals.loan_amount` |
| SBA guaranty coverage | `buddy_sba_packages.sba_guarantee_pct` |
| Base DSCR | `buddy_sba_packages.dscr_year1_base` |
| Stress DSCR | `buddy_sba_packages.dscr_year1_downside` |
| Projected-vs-historical variance | computed from `buddy_sba_packages.projections_annual` vs `deal_financial_facts` |
| Global cash flow DSCR | `buddy_sba_packages.global_dscr` |
| Loan term risk | existing `sbaRiskProfile.loanTermFactor` |
| SBA Franchise Directory status | `franchise_brands.sba_directory_status` |
| FDD Item 19 tier | `fdd_item19_facts` (tier derived from AUV / EBITDA range) |
| Brand maturity | `franchise_brands.total_open_units` |
| Franchisor support | `franchise_brands.franchisor_support_score` (may need computing) |

If any column doesn't exist yet, Sprint 0 identifies the gap and either:
- Adds the column with a nullable default (if it's a single missing field), OR
- Marks the sub-factor as `missing_inputs` and proceeds (component re-normalizes)

---

## API surface

### New route: `POST /api/deals/[dealId]/buddy-sba-score/compute`

Triggers score computation. Returns the full `BuddySBAScore`. Requires bank-member auth for the deal's tenant.

### New route: `GET /api/deals/[dealId]/buddy-sba-score/latest`

Returns the most recent non-superseded score for the deal. Includes full explainability.

### New route: `GET /api/deals/[dealId]/buddy-sba-score/history`

Returns all score versions for the deal, ordered by computed_at desc. Shows how the score evolved as facts landed.

All three routes gated by existing `requireDealAccess` helper.

---

## Integration points

### Sprint 1 integration

The brokerage concierge triggers a score computation whenever a deal's fact set materially changes. Specifically, after concierge turn 5 (enough facts to produce a meaningful preliminary score), and after every document upload that resolves missing inputs.

### Sprint 3 integration

The borrower portal shows the current score (most recent non-superseded) with a "what this means" explainer. Before sealing, the score is visible but draft-flagged; at sealing, it locks.

### Sprint 5 integration

The Key Facts Summary generator consumes the locked score and its component breakdown. The KFS shows the overall score, band, component scores, and top strengths/weaknesses.

### Sprint 6 integration

The marketplace listing publishes the score. The rate card lookup keys on `band` + SBA program + loan tier + term.

---

## Acceptance criteria

1. Migration applied; `buddy_sba_scores` table exists with RLS.
2. `computeBuddySBAScore` runs against the Samaritus test deal and returns a coherent score (any score 0–100 with populated components; manual review confirms it's reasonable).
3. Missing-input handling: running against a deal with half the inputs populated returns a score with re-normalized components and populated `missingInputs` arrays.
4. Eligibility gate: running against a deal that fails SOP eligibility returns `score: 0, band: 'not_eligible'` with populated `eligibilityFailures`.
5. Franchise detection: a franchise deal includes `franchiseQuality`; a non-franchise deal has `franchiseQuality: null` and weights redistribute.
6. Idempotency + versioning: re-running on the same deal with same inputs produces the same score and marks the previous row `superseded_at`.
7. Explainability: the full `BuddySBAScore` object contains a source citation for every sub-factor; none are missing attribution.
8. Three API routes return sane responses under 2 seconds each.
9. No LLM in the scoring path (grep the module — no Gemini/OpenAI imports except possibly for narrative templating, which should be deterministic prose anyway).
10. SR 11-7 defense: any sub-factor's score is explainable in one sentence citing the input value and the scoring curve applied.

---

## Test plan

- **Unit:** every scoring curve function, edge cases (null, below-min, above-max, exactly at tier boundaries).
- **Integration:** run against Samaritus deal; compare to manual calculation; tune curves if score is obviously wrong.
- **Backfill test:** run against 5–10 historical deals in the Samaritus dataset; produce a distribution of scores; eyeball whether the distribution is reasonable (not all clustered at 50, not all 90+).
- **Versioning test:** compute score, change a scoring curve in `scoringCurves.ts`, bump `SCORE_VERSION`, recompute; verify new row inserted and old row marked superseded.
- **Eligibility gate test:** deal with a known SBA ineligibility (e.g., passive real estate investment) returns score 0.

---

## Rollout

- Deploy migration + score code to production with routes disabled from UI.
- Backfill scores for the existing Samaritus deal and any other test deals in the DB.
- Manual review: do the scores match intuition? If not, tune scoring curves.
- Enable score display in the banker cockpit (read-only) for a week of internal validation.
- Then Sprint 1 builds on it.

---

## Notes for implementer

- Reuse `sbaRiskProfile.ts` factors directly — don't duplicate industry default or loan term logic.
- The existing `eligibilityEngine.ts` is 2.5KB — likely a stub. If so, Sprint 0 extends it to cover SOP 50 10 7.1 ineligibility checks comprehensively (for-profit test, size standards, use of proceeds eligibility, passive business test, lending/investment business exclusion, etc.). This may be a sub-sprint inside Sprint 0.
- Scoring curves should be ENV-configurable eventually (so we can tune without deploys) but for launch, hardcoded in `scoringCurves.ts` is fine.
- NARRATIVE MUST BE DETERMINISTIC. Do not let an LLM touch the score narrative. It's templated prose composed from the component facts.
