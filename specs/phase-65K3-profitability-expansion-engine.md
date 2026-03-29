# Phase 65K.3 — Relationship Profitability + Expansion Engine
## Status: Spec — Ready for implementation after 65K.2 merge
## Depends On: Phase 65K.1 (Relationship Registry), 65K.2 (Deposit + Treasury Operationalization)
## Feature Flag: `BUDDY_RELATIONSHIP_OS_ENABLED` + `BUDDY_RELATIONSHIP_EXPANSION_ENABLED` (both required)

---

## Objective

Convert Buddy from a relationship operations system into a **governed relationship growth system**.

Phase 65K.3 adds:
- deterministic relationship profitability canon
- evidence-backed expansion opportunity detection
- banker-reviewed expansion case workflows
- renewal fusion with relationship depth and value assessment
- command-center-visible growth actions that remain subordinate to risk, monitoring, review, and renewal urgency

This phase does **not** turn Buddy into a CRM.
This phase does **not** allow profitability to override policy, credit discipline, or required banker review.

Buddy remains deterministic, auditable, server-derived, evidence-based, one OS.

---

## Why This Phase Exists

65K.1 created the relationship canonical spine.
65K.2 made deposit and treasury operational.

65K.3 makes the relationship economically intelligible and strategically actionable by answering:

- What is this relationship worth?
- What is missing from the relationship?
- Where is Buddy leaving value on the table?
- Which opportunities are real vs speculative?
- What should the banker do next to deepen or protect the relationship?
- How should renewal readiness incorporate relationship depth and total value?

Without 65K.3, Buddy can manage the relationship.
With 65K.3, Buddy can also **grow the relationship intelligently and safely**.

---

## Product Goal

Buddy should deterministically surface:
- relationship profitability
- pricing flexibility context
- deposit capture gaps
- treasury adoption gaps
- renewal-with-shallow-relationship warnings
- relationship deepening opportunities
- relationship protection pressure where value and retention are at risk

All of this must be banker-reviewable, auditable, subordinate to risk doctrine, explainable, and integrated into one command center.

---

## Scope

### Included
- Relationship profitability snapshots
- Deterministic profitability band derivation
- Relationship value trend derivation
- Cross-sell / deepening opportunity derivation as governed expansion opportunities
- Expansion case registry
- Banker review workflow for opportunities
- Renewal relationship assessment
- Command center integration for expansion/profitability actions
- Timeline / ledger events for opportunity and profitability transitions
- Canonical pack extension with profitability + expansion summary
- Integration with 65K.1 and 65K.2 outputs

### Explicitly Out of Scope
- Banker compensation logic
- Quota tracking
- CRM-style lead stages
- Autonomous borrower-facing sales outreach
- Final crypto relationship extension (65K.5)
- Advanced treasury revenue forecasting
- Portfolio-wide campaign automation
- Policy exceptions based on profitability

---

## Core Doctrine

1. Profitability informs prioritization and strategy; it never overrides risk doctrine.
2. Expansion opportunities must be evidence-backed and deterministic.
3. Opportunities are not CRM notes; they are governed operating artifacts.
4. Banker review is required before expansion becomes borrower-facing.
5. Relationship depth matters at renewal.
6. A profitable relationship can still be high risk.
7. A shallow relationship can still be credit-strong.
8. Canonical relationship truth remains primary; profitability and expansion are relationship dimensions.
9. Expansion work must remain subordinate to critical risk, exception, review, and renewal urgency.
10. Borrowers never see internal revenue language: wallet share, profitability gap, cross-sell target, relationship monetization.

---

## Canonical Layer Extensions

Extend the relationship canonical pack with profitability + expansion fields.

### New Types

```ts
// ─── Profitability Types ────────────────────────────────────────────
export type RelationshipProfitabilityBand =
  | "unknown"
  | "negative"
  | "low"
  | "moderate"
  | "strong"
  | "high_value";

export type PricingFlexibilityStatus =
  | "unknown"
  | "none"
  | "limited"
  | "moderate"
  | "meaningful";

export type RelationshipValueTrend =
  | "unknown"
  | "improving"
  | "stable"
  | "declining";

export type RelationshipDepth =
  | "shallow"
  | "moderate"
  | "deep";

// ─── Expansion Types ───────────────────────────────────────────────
export type ExpansionReadiness =
  | "not_applicable"
  | "review_required"
  | "ready"
  | "active_case_open"
  | "stalled";

export type ExpansionOpportunityType =
  | "deposit_capture"
  | "operating_account_migration"
  | "lockbox"
  | "ach_origination"
  | "positive_pay"
  | "sweep_account"
  | "remote_deposit_capture"
  | "pricing_review"
  | "renewal_bundle"
  | "relationship_deepening";

export type ExpansionOpportunityStatus =
  | "identified"
  | "under_review"
  | "approved"
  | "case_open"
  | "proposed"
  | "in_progress"
  | "completed"
  | "declined"
  | "stalled"
  | "closed";

// ─── Renewal Assessment ─────────────────────────────────────────────
export interface RenewalRelationshipAssessment {
  relationshipDepth: RelationshipDepth;
  depositCaptureStatus: DepositCaptureStatus;
  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  profitabilityBand: RelationshipProfitabilityBand;
  runoffRisk: "low" | "moderate" | "high" | "unknown";
  expansionBundleRecommended: boolean;
}

// ─── Canonical Pack Extension ───────────────────────────────────────
export interface RelationshipProfitabilityExpansionPack {
  profitabilityBand: RelationshipProfitabilityBand;
  pricingFlexibilityStatus: PricingFlexibilityStatus;
  relationshipValueTrend: RelationshipValueTrend;
  relationshipDepth: RelationshipDepth;

  annualLoanRevenueEstimate: number | null;
  annualDepositValueEstimate: number | null;
  annualTreasuryRevenueEstimate: number | null;
  annualTotalRelationshipValueEstimate: number | null;

  activeExpansionOpportunityCount: number;
  activeExpansionCaseCount: number;
  expansionReadiness: ExpansionReadiness;

  renewalRelationshipAssessment: RenewalRelationshipAssessment | null;
}
```

### Hard Rule

These are derived server-side only. No UI local derivation. No manual banker override of canonical profitability or depth values.

---

## Database Schema

### Migration: `supabase/migrations/20260615_relationship_profitability_expansion.sql`

```sql
-- =============================================================
-- Phase 65K.3 — Relationship Profitability + Expansion Engine
-- Depends: 20260530_relationship_registry.sql (65K.1)
--          20260601_relationship_treasury_deposit.sql (65K.2)
-- =============================================================

-- ─── 1. Profitability Snapshots ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_profitability_snapshots (
  id                                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id                         uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                                 uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  annual_loan_revenue_estimate            numeric,
  annual_deposit_value_estimate           numeric,
  annual_treasury_revenue_estimate        numeric,
  annual_total_relationship_value_estimate numeric,

  profitability_band                      text NOT NULL DEFAULT 'unknown'
    CHECK (profitability_band IN ('unknown','negative','low','moderate','strong','high_value')),
  pricing_flexibility_status              text NOT NULL DEFAULT 'unknown'
    CHECK (pricing_flexibility_status IN ('unknown','none','limited','moderate','meaningful')),
  relationship_value_trend                text NOT NULL DEFAULT 'unknown'
    CHECK (relationship_value_trend IN ('unknown','improving','stable','declining')),
  relationship_depth                      text NOT NULL DEFAULT 'shallow'
    CHECK (relationship_depth IN ('shallow','moderate','deep')),

  evidence                                jsonb NOT NULL DEFAULT '{}'::jsonb,
  computation_version                     text NOT NULL DEFAULT '65K.3',
  computed_at                             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_profitability_rel_time
  ON public.relationship_profitability_snapshots (relationship_id, computed_at DESC);
CREATE INDEX idx_rel_profitability_bank_time
  ON public.relationship_profitability_snapshots (bank_id, computed_at DESC);
CREATE INDEX idx_rel_profitability_band
  ON public.relationship_profitability_snapshots (profitability_band, computed_at DESC);

-- ─── 2. Expansion Opportunities ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_expansion_opportunities (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id                 uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                         uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  opportunity_type                text NOT NULL
    CHECK (opportunity_type IN (
      'deposit_capture','operating_account_migration','lockbox',
      'ach_origination','positive_pay','sweep_account',
      'remote_deposit_capture','pricing_review','renewal_bundle',
      'relationship_deepening'
    )),
  status                          text NOT NULL DEFAULT 'identified'
    CHECK (status IN (
      'identified','under_review','approved','case_open',
      'proposed','in_progress','completed','declined','stalled','closed'
    )),
  confidence                      text NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high','medium','low')),
  priority                        text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('critical','high','normal','low')),

  rationale                       text NOT NULL,
  evidence                        jsonb NOT NULL DEFAULT '{}'::jsonb,

  source_profitability_snapshot_id uuid REFERENCES public.relationship_profitability_snapshots(id) ON DELETE SET NULL,
  source_relationship_snapshot_id  uuid REFERENCES public.relationship_state_snapshots(id) ON DELETE SET NULL,

  first_detected_at               timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at               timestamptz NOT NULL DEFAULT now(),
  closed_at                       timestamptz
);

-- Only one open opportunity per type per relationship
CREATE UNIQUE INDEX uq_rel_expansion_open_opportunity
  ON public.relationship_expansion_opportunities (relationship_id, opportunity_type)
  WHERE closed_at IS NULL;

CREATE INDEX idx_rel_expansion_opps_rel
  ON public.relationship_expansion_opportunities (relationship_id);
CREATE INDEX idx_rel_expansion_opps_bank_status
  ON public.relationship_expansion_opportunities (bank_id, status);

-- ─── 3. Expansion Cases ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_expansion_cases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id             uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                     uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  opportunity_id              uuid NOT NULL REFERENCES public.relationship_expansion_opportunities(id) ON DELETE CASCADE,

  status                      text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open','banker_review_required','ready',
      'borrower_outreach_open','in_progress',
      'completed','stalled','closed'
    )),
  owner_user_id               text,
  primary_action_code         text,

  banker_review_required      boolean NOT NULL DEFAULT true,
  banker_review_completed_at  timestamptz,
  banker_review_completed_by  text,

  borrower_package_id         uuid,
  outcome                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence                    jsonb NOT NULL DEFAULT '{}'::jsonb,

  opened_at                   timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  closed_at                   timestamptz
);

-- One active case per opportunity
CREATE UNIQUE INDEX uq_rel_expansion_active_case
  ON public.relationship_expansion_cases (opportunity_id)
  WHERE closed_at IS NULL;

CREATE INDEX idx_rel_expansion_cases_rel
  ON public.relationship_expansion_cases (relationship_id);
CREATE INDEX idx_rel_expansion_cases_bank_status
  ON public.relationship_expansion_cases (bank_id, status);

-- ─── 4. Renewal Relationship Assessments ────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_renewal_assessments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id             uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                     uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  renewal_case_id             uuid,

  relationship_depth          text NOT NULL
    CHECK (relationship_depth IN ('shallow','moderate','deep')),
  deposit_capture_status      text NOT NULL,
  treasury_adoption_status    text NOT NULL,
  profitability_band          text NOT NULL
    CHECK (profitability_band IN ('unknown','negative','low','moderate','strong','high_value')),
  runoff_risk                 text NOT NULL
    CHECK (runoff_risk IN ('low','moderate','high','unknown')),
  expansion_bundle_recommended boolean NOT NULL DEFAULT false,

  evidence                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_renewal_assessments_rel
  ON public.relationship_renewal_assessments (relationship_id, computed_at DESC);
CREATE INDEX idx_rel_renewal_assessments_bank
  ON public.relationship_renewal_assessments (bank_id, computed_at DESC);

-- ─── 5. Expansion Events Ledger ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_expansion_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id           uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  event_code        text NOT NULL,
  actor_type        text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system','banker','borrower','cron','migration')),
  actor_user_id     text,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_expansion_events_rel_time
  ON public.relationship_expansion_events (relationship_id, created_at DESC);
CREATE INDEX idx_rel_expansion_events_code
  ON public.relationship_expansion_events (event_code, created_at DESC);

-- ─── 6. RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.relationship_profitability_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_expansion_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_expansion_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_renewal_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_expansion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rel_profitability_bank_isolation" ON public.relationship_profitability_snapshots
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_expansion_opps_bank_isolation" ON public.relationship_expansion_opportunities
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_expansion_cases_bank_isolation" ON public.relationship_expansion_cases
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_renewal_assessments_bank_isolation" ON public.relationship_renewal_assessments
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_expansion_events_bank_isolation" ON public.relationship_expansion_events
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
```

---

## Pure Functions

All pure functions: zero DB imports, deterministic, zero side effects, no Date.now unless injected.

### File: `src/core/relationship/profitability/deriveRelationshipProfitabilityBand.pure.ts`

```typescript
/**
 * Maps relationship revenue/value inputs to a canonical profitability band.
 * Wraps and extends existing analyzeRelationshipPricing() output.
 */
export function deriveRelationshipProfitabilityBand(
  input: ProfitabilityDerivationInput
): RelationshipProfitabilityBand
```

**Input type:**
```typescript
interface ProfitabilityDerivationInput {
  annualLoanRevenueEstimate: number | null;
  annualDepositValueEstimate: number | null;
  annualTreasuryRevenueEstimate: number | null;
  annualTotalRelationshipValueEstimate: number | null;
  totalExposure: number | null;
  // Configurable thresholds (not hardcoded magic values)
  thresholds: ProfitabilityThresholds;
}

interface ProfitabilityThresholds {
  negativeCeiling: number;        // below this = negative
  lowCeiling: number;             // below this = low
  moderateFloor: number;          // above this = moderate
  strongFloor: number;            // above this = strong
  highValueFloor: number;         // above this = high_value
}
```

**Rules (priority order):**
- `"unknown"` — annualTotalRelationshipValueEstimate is null OR totalExposure is null
- `"negative"` — total value < thresholds.negativeCeiling
- `"low"` — total value < thresholds.lowCeiling
- `"moderate"` — total value >= thresholds.moderateFloor AND < strongFloor
- `"strong"` — total value >= thresholds.strongFloor AND < highValueFloor
- `"high_value"` — total value >= thresholds.highValueFloor

### File: `src/core/relationship/profitability/derivePricingFlexibilityStatus.pure.ts`

```typescript
/**
 * Derives pricing flexibility context from total relationship value and depth.
 * This is CONTEXT ONLY — it does not authorize pricing decisions.
 */
export function derivePricingFlexibilityStatus(
  input: PricingFlexibilityDerivationInput
): PricingFlexibilityStatus
```

**Input type:**
```typescript
interface PricingFlexibilityDerivationInput {
  relationshipDepth: RelationshipDepth;
  profitabilityBand: RelationshipProfitabilityBand;
  depositRelationshipStatus: DepositRelationshipStatus;
  impliedLoanSpreadAdjustmentBps: number | null; // from analyzeRelationshipPricing()
}
```

**Rules:**
- `"unknown"` — missing data or profitability unknown
- `"none"` — negative/low profitability, shallow depth, no deposit support
- `"limited"` — low-moderate profitability OR partial deposit only
- `"moderate"` — moderate+ profitability AND partial+ deposit
- `"meaningful"` — strong+ profitability AND primary_operating+ deposit AND moderate+ depth

### File: `src/core/relationship/profitability/deriveRelationshipValueTrend.pure.ts`

```typescript
export function deriveRelationshipValueTrend(
  input: ValueTrendDerivationInput
): RelationshipValueTrend
```

**Input type:**
```typescript
interface ValueTrendDerivationInput {
  snapshots: Array<{
    computedAt: string;
    annualTotalRelationshipValueEstimate: number | null;
  }>;
  minimumSnapshotsForTrend: number; // default 2
}
```

**Rules:**
- `"unknown"` — fewer than minimumSnapshotsForTrend snapshots with non-null values
- `"improving"` — latest value > previous by > 5% (configurable)
- `"declining"` — latest value < previous by > 5%
- `"stable"` — change within +/- 5%

### File: `src/core/relationship/profitability/deriveRelationshipDepth.pure.ts`

```typescript
/**
 * Derives depth from deposit capture + treasury adoption + breadth of active relationship.
 */
export function deriveRelationshipDepth(
  input: DepthDerivationInput
): RelationshipDepth
```

**Input type:**
```typescript
interface DepthDerivationInput {
  depositCaptureStatus: DepositCaptureStatus;
  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  activeDealCount: number;
  activeMonitoringProgramCount: number;
  activeTreasuryProductCount: number;
}
```

**Rules:**
- `"deep"` — depositCaptureStatus in (primary_captured, deepened) AND treasuryAdoptionStatus in (active, multi_product)
- `"moderate"` — depositCaptureStatus in (partial_capture, primary_captured) OR treasuryAdoptionStatus in (proposed, in_onboarding, active) OR activeTreasuryProductCount >= 1
- `"shallow"` — fallback (loan-only or minimal operating relationship)

### File: `src/core/relationship/profitability/deriveExpansionOpportunities.pure.ts`

```typescript
/**
 * Deterministically identifies evidence-backed relationship growth opportunities.
 * Composes treasury opportunities (65K.2) with profitability and depth signals.
 */
export function deriveExpansionOpportunities(
  input: ExpansionOpportunityDerivationInput
): DerivedExpansionOpportunity[]
```

**Input type:**
```typescript
interface ExpansionOpportunityDerivationInput {
  relationshipDepth: RelationshipDepth;
  depositCaptureStatus: DepositCaptureStatus;
  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  profitabilityBand: RelationshipProfitabilityBand;
  hasExternalPrimaryBank: boolean;
  existingTreasuryProducts: TreasuryProductType[];
  treasuryOpportunities: DerivedTreasuryOpportunity[]; // from 65K.2
  hasOpenRenewal: boolean;
  nearestRenewalDueAt: string | null;
  pricingFlexibilityStatus: PricingFlexibilityStatus;
}
```

**Output type:**
```typescript
interface DerivedExpansionOpportunity {
  opportunityType: ExpansionOpportunityType;
  confidence: "high" | "medium" | "low";
  priority: "critical" | "high" | "normal" | "low";
  rationale: string;
  evidence: Record<string, unknown>;
}
```

**Detection rules:**
- `deposit_capture` — depositCaptureStatus in (not_started, signals_detected) AND hasExternalPrimaryBank
- `operating_account_migration` — hasExternalPrimaryBank AND deposit is none/partial
- Treasury-specific types — from 65K.2 deriveTreasuryOpportunities() output, filtered against existingTreasuryProducts
- `pricing_review` — pricingFlexibility is moderate/meaningful AND profitability is moderate+ AND no recent pricing review
- `renewal_bundle` — hasOpenRenewal AND relationshipDepth is shallow AND (deposit not captured OR treasury adoption < active)
- `relationship_deepening` — profitability is low/moderate AND depth is shallow AND no other specific opportunity covers the gap

**Hard rule:** No opportunity without structured evidence.

### File: `src/core/relationship/profitability/deriveExpansionReadiness.pure.ts`

```typescript
export function deriveExpansionReadiness(
  input: ExpansionReadinessDerivationInput
): ExpansionReadiness
```

**Rules:**
- `"not_applicable"` — no current opportunities
- `"stalled"` — any opportunity or case stale beyond threshold
- `"active_case_open"` — open case exists
- `"ready"` — approved opportunities, no open case
- `"review_required"` — opportunities exist but banker review not completed

### File: `src/core/relationship/profitability/deriveExpansionNextActions.pure.ts`

```typescript
export function deriveExpansionNextActions(
  input: ExpansionNextActionDerivationInput
): RelationshipNextAction[]
```

**Action mapping rules:**

| Condition | Action Code | Family | Blocking Party |
|---|---|---|---|
| Profitability snapshot needs review or trend changed | `review_profitability` | `expand_relationship` | banker |
| Opportunities detected, no review | `review_expansion_opportunities` | `expand_relationship` | banker |
| Opportunity approved, no case | `open_expansion_case` | `expand_relationship` | banker |
| Case open, next step pending | `advance_expansion_case` | `expand_relationship` | banker |
| Renewal + shallow relationship | `prepare_renewal_bundle` | `prepare_renewal` | banker |
| Pricing context warrants review | `review_pricing_context` | `expand_relationship` | banker |

### File: `src/core/relationship/profitability/buildProfitabilityExpansionExplanations.pure.ts`

```typescript
export function buildProfitabilityExpansionExplanations(
  input: ProfitabilityExpansionExplanationInput
): string[]
```

Returns 1-4 human-readable strings. Examples:
- `"Relationship value estimated at $47,200/yr (strong) — improving trend"`
- `"3 expansion opportunities identified; deposit capture is highest priority"`
- `"Renewal approaching with shallow relationship — bundle recommended"`
- `"Pricing flexibility is moderate based on deposit depth and total value"`

### File: `src/core/relationship/profitability/buildRenewalRelationshipAssessment.pure.ts`

```typescript
/**
 * Derives relationship-aware renewal context. Returns null if no renewal is active.
 */
export function buildRenewalRelationshipAssessment(
  input: RenewalAssessmentInput
): RenewalRelationshipAssessment | null
```

**Input type:**
```typescript
interface RenewalAssessmentInput {
  hasOpenRenewal: boolean;
  relationshipDepth: RelationshipDepth;
  depositCaptureStatus: DepositCaptureStatus;
  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  profitabilityBand: RelationshipProfitabilityBand;
  depositRunoffWatch: boolean;
  relationshipValueTrend: RelationshipValueTrend;
}
```

**Rules:**
- Returns null if !hasOpenRenewal
- `runoffRisk`:
  - `"high"` — depositRunoffWatch AND valuetrend declining
  - `"moderate"` — depositRunoffWatch OR valueTrend declining
  - `"low"` — neither
  - `"unknown"` — insufficient data
- `expansionBundleRecommended`:
  - true when depth is shallow AND (deposit not primary_captured+ OR treasury not active+)
  - false when depth is deep OR no obvious gaps

### File: `src/core/relationship/profitability/types.ts`

All profitability/expansion-specific types. Zero runtime imports.

---

## Blocker Taxonomy Additions

Extend `RelationshipBlockerCode` from 65K.1 + 65K.2:

```typescript
// Added in 65K.3
export type ProfitabilityExpansionBlockerCode =
  | "profitability_review_required"
  | "expansion_review_required"
  | "expansion_case_open"
  | "renewal_relationship_gap";
```

**Blocking party rules:**
- `profitability_review_required` → banker
- `expansion_review_required` → banker
- `expansion_case_open` → banker unless borrower package explicitly outstanding
- `renewal_relationship_gap` → banker by default; becomes borrower if package already launched and items outstanding

**Severity:** Profitability/expansion blockers are always lower priority than credit, monitoring, renewal, annual review, and treasury stall blockers. Priority order:
1. Integrity failure
2. Critical monitoring / protection issue
3. Renewal urgency
4. Annual review urgency
5. Banker review gates
6. Treasury onboarding stall
7. Profitability / expansion review

---

## Action Taxonomy Additions

Extend `RelationshipActionCode` from 65K.1 + 65K.2:

```typescript
// Added in 65K.3
export type ProfitabilityExpansionActionCode =
  | "review_profitability"
  | "review_expansion_opportunities"
  | "open_expansion_case"
  | "advance_expansion_case"
  | "prepare_renewal_bundle"
  | "review_pricing_context";
```

---

## Event Taxonomy

### `relationship_expansion_events.event_code` values:

```typescript
export type RelationshipExpansionEventCode =
  | "profitability_snapshot_computed"
  | "profitability_band_changed"
  | "relationship_depth_changed"
  | "value_trend_changed"
  | "expansion_opportunity_identified"
  | "expansion_opportunity_closed"
  | "expansion_opportunity_approved"
  | "expansion_case_opened"
  | "expansion_case_advanced"
  | "expansion_case_stalled"
  | "expansion_case_completed"
  | "renewal_relationship_assessment_computed"
  | "renewal_bundle_recommended";
```

**Hard rule:** Append-only. Corrections are new events.

---

## Opportunity Lifecycle

### States

```
identified → under_review → approved → case_open → proposed → in_progress → completed
                                                                               ↘ closed
                                          any active state → stalled
                                          any active state → declined → closed
```

### Transition Rules

| From | To | Trigger |
|---|---|---|
| `identified` | `under_review` | Detected, awaiting banker validation |
| `under_review` | `approved` | Banker confirms opportunity is valid |
| `approved` | `case_open` | Governed expansion case opens |
| `case_open` | `proposed` | Internal-approved outreach/package created |
| `proposed` | `in_progress` | Borrower or banker workflow begins meaningfully |
| `in_progress` | `completed` | Evidence-backed outcome achieved, banker confirms |
| any active state | `stalled` | Inactivity threshold breached |
| any active state | `declined` | Banker/borrower declines |
| completed/declined/stalled | `closed` | Finalized or superseded |

**Hard rule:** Detection is system-derived. Approval is banker-reviewed. Completion is evidence-backed.

---

## Renewal Fusion

This is the defining workflow of 65K.3.

At renewal time, Buddy assesses not just credit readiness, but also:
- relationship depth
- deposit capture
- treasury adoption
- total relationship value
- runoff risk
- whether a relationship-deepening bundle is warranted

### Renewal bundle recommendation rules

Recommend `renewal_bundle` when:
- Renewal case open or due soon
- Relationship depth = `shallow`
- Deposit capture not primary_captured+ or deepened
- Treasury adoption is `none`, `recommended`, or `under_review`
- No higher-severity blocker suppresses it

**Hard rule:** A renewal bundle is a governed recommendation, not an automatic borrower-facing cross-sell.

---

## Server Orchestrators

### File: `src/core/relationship/profitability/resolveRelationshipProfitabilityExpansionPack.ts`

```typescript
import "server-only";

/**
 * Server orchestrator. Extends the canonical pack with profitability + expansion.
 * Never throws.
 */
export async function resolveRelationshipProfitabilityExpansionPack(
  relationshipId: string
): Promise<RelationshipProfitabilityExpansionPack>
```

**Steps:**
1. Fetch relationship core canon + 65K.2 treasury/deposit pack
2. Fetch profitability source inputs (from existing `analyzeRelationshipPricing()`)
3. Fetch recent profitability snapshots (for trend)
4. Fetch open expansion opportunities
5. Fetch open expansion cases
6. Fetch renewal case context if applicable
7. Normalize into pure derivation inputs
8. Call pure functions: profitabilityBand, pricingFlexibility, valueTrend, depth, opportunities, readiness, nextActions, explanations, renewalAssessment
9. Persist: profitability snapshot, upsert opportunities, renewal assessment
10. Append events for material state changes
11. Return pack

### File: `src/core/relationship/profitability/upsertRelationshipProfitabilitySnapshot.ts`

```typescript
import "server-only";

/**
 * Computes and persists a profitability snapshot.
 * Uses existing analyzeRelationshipPricing() + deposit profile + treasury product states.
 * Snapshots are immutable after insert.
 */
export async function upsertRelationshipProfitabilitySnapshot(
  relationshipId: string,
  bankId: string
): Promise<void>
```

### File: `src/core/relationship/profitability/upsertExpansionOpportunities.ts`

```typescript
import "server-only";

/**
 * Derives expansion opportunities, upserts open ones (deduped by type),
 * closes opportunities no longer supported by evidence.
 */
export async function upsertExpansionOpportunities(
  relationshipId: string,
  bankId: string
): Promise<void>
```

### File: `src/core/relationship/profitability/approveExpansionOpportunity.ts`

```typescript
import "server-only";

/**
 * Banker approves an expansion opportunity.
 * Transitions: under_review → approved.
 */
export async function approveExpansionOpportunity(
  opportunityId: string,
  approvedBy: string
): Promise<void>
```

### File: `src/core/relationship/profitability/openExpansionCase.ts`

```typescript
import "server-only";

/**
 * Opens a governed expansion case for an approved opportunity.
 * One active case per opportunity.
 */
export async function openExpansionCase(
  opportunityId: string,
  openedBy: string
): Promise<{ caseId: string }>
```

### File: `src/core/relationship/profitability/advanceExpansionCase.ts`

```typescript
import "server-only";

/**
 * Advances an expansion case through its lifecycle.
 * Validates transition legality, persists, emits event.
 */
export async function advanceExpansionCase(
  caseId: string,
  newStatus: string,
  evidence: Record<string, unknown>,
  actorId: string
): Promise<void>
```

### File: `src/core/relationship/profitability/upsertRenewalRelationshipAssessment.ts`

```typescript
import "server-only";

/**
 * Computes and persists a renewal relationship assessment.
 * Called when renewal exists and relationship context materially changes.
 */
export async function upsertRenewalRelationshipAssessment(
  relationshipId: string,
  bankId: string,
  renewalCaseId: string | null
): Promise<void>
```

### File: `src/core/relationship/profitability/logRelationshipExpansionEvent.ts`

```typescript
import "server-only";

/**
 * Appends to relationship_expansion_events ledger.
 */
export async function logRelationshipExpansionEvent(
  input: {
    relationshipId: string;
    bankId: string;
    eventCode: RelationshipExpansionEventCode;
    actorType: "system" | "banker" | "borrower" | "cron";
    actorUserId?: string;
    payload?: Record<string, unknown>;
  }
): Promise<void>
```

---

## Orchestrator Extension

### Extend `resolveRelationshipCanonicalPack()` (from 65K.1, extended in 65K.2)

Updated flow:
1. Fetch relationship core canon facts
2. Fetch 65K.2 deposit and treasury facts
3. Fetch profitability source inputs
4. Fetch recent profitability snapshots
5. Fetch expansion opportunities
6. Fetch expansion cases
7. Fetch renewal case context if applicable
8. Normalize into pure input object
9. Run 65K.1 pure chain
10. Run 65K.2 pure chain
11. Run 65K.3 profitability/expansion pure chain
12. Merge blockers/actions with canonical prioritization
13. Persist profitability snapshots / opportunities / cases / assessments
14. Append events
15. Return merged canonical pack

**Required behavior:**
- Never throws
- Canonical response still returns if profitability or expansion persistence partially fails
- Projections remain rebuildable
- One primary relationship action still enforced

---

## Materialization / Rebuild Rules

### Profitability snapshots
- Persist new snapshot when material value inputs change or trend/band changes
- Immutable after insert

### Expansion opportunities
- Upsert open opportunities by `(relationship_id, opportunity_type)`
- Refresh `last_confirmed_at` when still supported
- Close when evidence no longer supports them
- No duplicate open opportunity per type

### Expansion cases
- One active case per opportunity
- Case can only open after banker review/approval
- Closing opportunity should close or reconcile case

### Renewal assessment
- Persist new assessment when renewal exists and relationship context materially changes

### Command center projection
- Merged next actions rebuilt on refresh
- Exactly one primary action per relationship
- Expansion actions may not outrank critical monitoring, renewal, annual review, or integrity failures

---

## Borrower Experience

Borrowers never see: profitability band, pricing flexibility, wallet share, relationship monetization, expansion opportunity score.

Borrowers may see: account setup recommendations, cash management setup, payment automation, fraud protection setup, renewal preparation package, bundled relationship setup tasks.

### Borrower-safe package types
- `renewal_bundle`
- `treasury_deepening_follow_up`
- `operating_account_migration`
- `relationship_setup_follow_up`

---

## Command Center Extension

Do not create a second queue. Extend the same queue.

### New queue reason families
- `profitability_review_required`
- `expansion_review_required`
- `expansion_case_ready`
- `expansion_case_open`
- `renewal_relationship_gap`
- `pricing_context_review`

---

## API Surface

### `GET /api/relationships/[relationshipId]`
Extend response with `profitabilityExpansionPack: RelationshipProfitabilityExpansionPack`.

### `POST /api/relationships/[relationshipId]/refresh`
Now also refreshes profitability, expansion opportunities, renewal assessment.

### `GET /api/relationships/[relationshipId]/timeline`
Includes profitability/expansion events from `relationship_expansion_events`.

### `POST /api/relationships/[relationshipId]/expansion-opportunities/[opportunityId]/approve`
**File:** `src/app/api/relationships/[relationshipId]/expansion-opportunities/[opportunityId]/approve/route.ts`

Banker review approval. Auth: must be banker in same bank.

### `POST /api/relationships/[relationshipId]/expansion-opportunities/[opportunityId]/open-case`
**File:** `src/app/api/relationships/[relationshipId]/expansion-opportunities/[opportunityId]/open-case/route.ts`

Create governed expansion case. Auth: must be banker in same bank.

### `POST /api/relationships/[relationshipId]/expansion-cases/[caseId]/advance`
**File:** `src/app/api/relationships/[relationshipId]/expansion-cases/[caseId]/advance/route.ts`

Advance expansion workflow. Auth: must be banker in same bank.

### `GET /api/relationships/[relationshipId]/profitability`
**File:** `src/app/api/relationships/[relationshipId]/profitability/route.ts`

List profitability snapshots for relationship.

### `GET /api/relationships/[relationshipId]/expansion-opportunities`
**File:** `src/app/api/relationships/[relationshipId]/expansion-opportunities/route.ts`

List open expansion opportunities for relationship.

---

## Feature Flag

**File:** `src/lib/flags/relationshipOs.ts` (extend existing)

```typescript
export function isRelationshipExpansionEnabled(): boolean {
  return (
    isRelationshipOsEnabled() &&
    process.env.BUDDY_RELATIONSHIP_EXPANSION_ENABLED === "true"
  );
}
```

---

## Test Plan

### A. Migration + Constraints (8 tests)

| # | Test |
|---|---|
| 1 | All 5 new tables created |
| 2 | All CHECK constraints enforced |
| 3 | Unique open opportunity per type enforced |
| 4 | Unique active case per opportunity enforced |
| 5 | RLS enabled on all new tables |
| 6 | All indexes exist |
| 7 | Bank-scope integrity holds |
| 8 | Append-only event discipline preserved |

### B. Profitability Pure Functions (9 tests)

| # | Test |
|---|---|
| 9 | Derives `unknown` with insufficient data |
| 10 | Derives `negative` |
| 11 | Derives `low` |
| 12 | Derives `moderate` |
| 13 | Derives `strong` |
| 14 | Derives `high_value` |
| 15 | Derives pricing flexibility `none` |
| 16 | Derives pricing flexibility `meaningful` |
| 17 | Deterministic for same input |

### C. Value Trend + Depth (8 tests)

| # | Test |
|---|---|
| 18 | Trend `unknown` without enough history |
| 19 | Trend `improving` |
| 20 | Trend `stable` |
| 21 | Trend `declining` |
| 22 | Depth `shallow` |
| 23 | Depth `moderate` |
| 24 | Depth `deep` |
| 25 | Depth deterministic |

### D. Expansion Opportunity Derivation (10 tests)

| # | Test |
|---|---|
| 26 | Identifies deposit capture gap |
| 27 | Identifies operating account migration |
| 28 | Identifies treasury gap from shallow adoption |
| 29 | Identifies pricing review |
| 30 | Identifies renewal bundle |
| 31 | Identifies relationship deepening |
| 32 | Does not create unsupported opportunities |
| 33 | Deterministic for same input |
| 34 | Priority derived correctly |
| 35 | Confidence derived correctly |

### E. Expansion Readiness + Actions (8 tests)

| # | Test |
|---|---|
| 36 | Readiness `not_applicable` |
| 37 | Readiness `review_required` |
| 38 | Readiness `ready` |
| 39 | Readiness `active_case_open` |
| 40 | Readiness `stalled` |
| 41 | Maps to `review_profitability` |
| 42 | Maps to `review_expansion_opportunities` |
| 43 | Maps to `prepare_renewal_bundle` |

### F. Case Lifecycle Integration (8 tests)

| # | Test |
|---|---|
| 44 | Approve opportunity |
| 45 | Open case |
| 46 | Advance case |
| 47 | Case cannot open twice |
| 48 | Case stalls after inactivity threshold |
| 49 | Completed case closes correctly |
| 50 | Declined opportunity prevents open case |
| 51 | Borrower-facing step requires banker approval |

### G. Renewal Fusion Integration (7 tests)

| # | Test |
|---|---|
| 52 | Renewal assessment created when renewal exists |
| 53 | Shallow renewal recommends bundle |
| 54 | Deep relationship does not recommend bundle when not needed |
| 55 | High-severity blocker suppresses bundle action |
| 56 | Renewal assessment updates when relationship depth changes |
| 57 | Runoff risk included |
| 58 | Profitability band included |

### H. Orchestrator Integration (7 tests)

| # | Test |
|---|---|
| 59 | Merged canonical pack includes profitability/expansion fields |
| 60 | Persistence failure does not break canonical response |
| 61 | Opportunities upsert and close correctly |
| 62 | One primary action preserved |
| 63 | Timeline includes profitability/expansion events |
| 64 | Refresh is idempotent |
| 65 | Projections rebuild correctly |

### I. Guard Tests (8 tests)

| # | Test |
|---|---|
| 66 | No DB imports in pure profitability/expansion files |
| 67 | No `server-only` imports in pure files |
| 68 | No `Math.random` in pure files |
| 69 | No `fetch` in pure files |
| 70 | No UI local derivation of profitability/expansion state |
| 71 | No borrower completion bypass |
| 72 | Profitability does not override critical risk priority |
| 73 | Projection rebuildability preserved |

---

## File Manifest

```
src/core/relationship/profitability/
  types.ts                                              — All profitability/expansion types (zero runtime imports)
  deriveRelationshipProfitabilityBand.pure.ts           — Pure: profitability band
  derivePricingFlexibilityStatus.pure.ts                — Pure: pricing flexibility context
  deriveRelationshipValueTrend.pure.ts                  — Pure: value trend
  deriveRelationshipDepth.pure.ts                       — Pure: relationship depth
  deriveExpansionOpportunities.pure.ts                  — Pure: opportunity detection
  deriveExpansionReadiness.pure.ts                      — Pure: expansion readiness
  deriveExpansionNextActions.pure.ts                    — Pure: action derivation
  buildProfitabilityExpansionExplanations.pure.ts       — Pure: human-readable explanations
  buildRenewalRelationshipAssessment.pure.ts            — Pure: renewal fusion assessment
  resolveRelationshipProfitabilityExpansionPack.ts      — Server orchestrator (server-only)
  upsertRelationshipProfitabilitySnapshot.ts            — Server: persist snapshot
  upsertExpansionOpportunities.ts                       — Server: upsert opportunities
  approveExpansionOpportunity.ts                        — Server: banker approval
  openExpansionCase.ts                                  — Server: open case
  advanceExpansionCase.ts                               — Server: advance case
  upsertRenewalRelationshipAssessment.ts                — Server: renewal assessment
  logRelationshipExpansionEvent.ts                      — Server: event ledger
  __tests__/
    deriveRelationshipProfitabilityBand.test.ts
    derivePricingFlexibilityStatus.test.ts
    deriveRelationshipValueTrend.test.ts
    deriveRelationshipDepth.test.ts
    deriveExpansionOpportunities.test.ts
    deriveExpansionReadiness.test.ts
    expansionCaseLifecycle.integration.test.ts
    renewalFusion.integration.test.ts
    resolveRelationshipProfitabilityExpansionPack.integration.test.ts
    profitabilityExpansionGuard.test.ts

src/app/api/relationships/[relationshipId]/
  profitability/
    route.ts                                             — GET profitability snapshots
  expansion-opportunities/
    route.ts                                             — GET list opportunities
    [opportunityId]/
      approve/
        route.ts                                         — POST banker approve
      open-case/
        route.ts                                         — POST open expansion case
  expansion-cases/
    [caseId]/
      advance/
        route.ts                                         — POST advance case

supabase/migrations/
  20260615_relationship_profitability_expansion.sql       — Schema
```

---

## Acceptance Criteria

Phase 65K.3 is complete when:

1. Buddy can derive relationship profitability deterministically
2. Buddy can derive relationship depth deterministically
3. Buddy can detect evidence-backed expansion opportunities deterministically
4. Expansion opportunities require banker review before operational action
5. Governed expansion cases exist and are auditable
6. Renewal readiness includes relationship depth, deposit capture, treasury adoption, value, and runoff context
7. Command center surfaces profitability/expansion work in the same unified queue
8. Profitability/expansion work never outranks critical risk/review/renewal work improperly
9. All new tables are RLS-protected and auditable
10. 73+ tests pass (8 migration + 9 profitability + 8 trend/depth + 10 opportunity + 8 readiness + 8 lifecycle + 7 renewal + 7 integration + 8 guards)
11. `tsc --noEmit` clean
12. No Omega/AI dependency — everything deterministic

---

## What This Phase Enables

After 65K.3, Buddy is no longer just a relationship operating system that manages work. It becomes a relationship operating system that can **measure value, detect growth gaps, and govern expansion safely**. This creates the substrate for:

- **65K.4** — Protection engine can read profitability trends, depth signals, and expansion stalls as risk indicators
- **65K.5** — Crypto extension can integrate collateral positions into profitability and depth calculations
