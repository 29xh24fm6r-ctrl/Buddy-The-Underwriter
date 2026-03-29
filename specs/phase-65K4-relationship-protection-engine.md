# Phase 65K.4 — Relationship Protection Engine
## Status: Spec — Ready for implementation after 65K.3 merge
## Depends On: Phase 65K.1 (Registry), 65K.2 (Treasury/Deposit), 65K.3 (Profitability/Expansion)
## Feature Flag: `BUDDY_RELATIONSHIP_OS_ENABLED` + `BUDDY_RELATIONSHIP_PROTECTION_ENABLED` (both required)

---

## Objective

Add the protection layer to Buddy's Relationship OS so the system can detect, govern, and escalate relationship deterioration before it becomes:
- deposit runoff
- treasury abandonment
- shallow renewal fragility
- profitability collapse
- relationship loss despite acceptable credit performance

Phase 65K.4 makes Buddy capable of not only understanding and growing the relationship, but also **protecting it**.

This phase adds:
- deterministic relationship protection risk derivation
- governed protection opportunity/case workflows
- deposit runoff detection
- stalled treasury retention risk detection
- shallow-relationship renewal protection logic
- relationship deterioration tracking across time
- command-center-visible protection actions
- append-only protection ledger events
- renewal fusion with relationship protection context

This phase does **not** replace monitoring, annual review, renewal, or credit policy.
It adds a **relationship-level protection layer** that sits above and alongside those systems.

---

## Why This Phase Exists

65K.1 created the relationship canonical spine.
65K.2 operationalized deposits and treasury.
65K.3 added profitability and expansion.
65K.4 is the balancing layer.

Without 65K.4:
- Buddy can detect growth opportunities
- Buddy can measure relationship value
- Buddy can guide treasury onboarding
- But Buddy cannot yet govern relationship weakening in a systematic, auditable way

65K.4 answers:
- Are deposits leaving the bank?
- Is treasury onboarding stalling in a way that threatens retention?
- Is renewal approaching with a fragile relationship?
- Is relationship value deteriorating even if credit still looks acceptable?
- Is there a governed protection action the banker should take now?
- Should protection outrank expansion in the unified queue?

This is the phase that makes Buddy feel like an actual bank operating system rather than a lending-growth platform.

---

## Scope

### Included
- Relationship protection risk derivation
- Protection severity + reason code taxonomy
- Protection case registry
- Deposit runoff risk detection
- Treasury stall risk detection
- Relationship deterioration detection
- Renewal protection assessment
- Protection next actions
- Command center integration for protection work
- Append-only protection events
- Timeline integration
- Canonical pack extension with protection summary
- Interaction with 65K.1 / 65K.2 / 65K.3 outputs

### Explicitly Out of Scope
- Credit policy changes
- Covenant policy changes
- Collections / workout module (already exists: deal_workout_cases)
- Autonomous borrower retention outreach
- Banker compensation / incentive logic
- Portfolio-wide mass campaign automation
- Crypto collateral protection extension (65K.5)
- Borrower-facing churn scoring
- AI-generated operational truth

---

## Core Doctrine

1. Protection work outranks expansion work.
2. Protection work does not outrank critical integrity failures, hard policy breaches, or the highest-severity credit/monitoring issues.
3. Relationship risk is not the same as credit risk.
4. Strong credit can coexist with weak relationship depth.
5. A profitable relationship can still be at risk of runoff.
6. Protection cases must be evidence-backed and auditable.
7. Banker review is required before material borrower-facing protection workflows.
8. Borrower inactivity does not auto-resolve protection risk.
9. Canonical relationship truth remains primary; protection is a relationship dimension.
10. Append-only ledger discipline applies to all protection events.

---

## Canonical Layer Extensions

Extend the relationship canonical pack with protection fields.

### New Types

```ts
// ─── Protection Types ───────────────────────────────────────────────
export type RelationshipProtectionStatus =
  | "normal"
  | "watch"
  | "at_risk"
  | "active_case_open"
  | "stalled"
  | "resolved";

export type RelationshipProtectionSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type RelationshipRunoffRisk =
  | "low"
  | "moderate"
  | "high"
  | "critical"
  | "unknown";

export type RelationshipDeteriorationTrend =
  | "unknown"
  | "stable"
  | "softening"
  | "deteriorating"
  | "accelerating";

export type ProtectionReadiness =
  | "not_applicable"
  | "review_required"
  | "ready"
  | "active_case_open"
  | "stalled"
  | "resolved";

export type ProtectionOpportunityType =
  | "deposit_runoff_intervention"
  | "treasury_stall_intervention"
  | "renewal_relationship_protection"
  | "relationship_recovery"
  | "profitability_deterioration_review"
  | "borrower_reengagement";

export type ProtectionOpportunityStatus =
  | "identified"
  | "under_review"
  | "approved"
  | "case_open"
  | "in_progress"
  | "resolved"
  | "declined"
  | "stalled"
  | "closed";

export type ProtectionCaseStatus =
  | "open"
  | "banker_review_required"
  | "ready"
  | "borrower_outreach_open"
  | "in_progress"
  | "resolved"
  | "stalled"
  | "closed";

export type ProtectionOutcomeCode =
  | "runoff_risk_reduced"
  | "treasury_onboarding_recovered"
  | "renewal_bundle_completed"
  | "borrower_reengaged"
  | "relationship_stabilized"
  | "relationship_lost"
  | "no_change";

// ─── Reason Codes ───────────────────────────────────────────────────
export type ProtectionReasonCode =
  | "deposit_runoff_detected"
  | "deposit_capture_deteriorating"
  | "treasury_onboarding_stalled"
  | "renewal_with_shallow_relationship"
  | "relationship_value_declining"
  | "profitability_deteriorating"
  | "borrower_disengagement_pattern"
  | "relationship_depth_fragile"
  | "multi_signal_relationship_softening";

export interface DerivedProtectionReason {
  code: ProtectionReasonCode;
  severity: RelationshipProtectionSeverity;
  evidence: Record<string, unknown>;
}

// ─── Canonical Pack Extension ───────────────────────────────────────
export interface RelationshipProtectionPack {
  protectionStatus: RelationshipProtectionStatus;
  protectionSeverity: RelationshipProtectionSeverity | null;
  runoffRisk: RelationshipRunoffRisk;
  deteriorationTrend: RelationshipDeteriorationTrend;
  activeProtectionOpportunityCount: number;
  activeProtectionCaseCount: number;
  protectionReadiness: ProtectionReadiness;

  openProtectionReasons: ProtectionReasonCode[];
  treasuryStallRetentionRisk: boolean;
  renewalProtectionRecommended: boolean;

  latestProtectionAssessment: {
    protectionStatus: RelationshipProtectionStatus;
    protectionSeverity: RelationshipProtectionSeverity | null;
    runoffRisk: RelationshipRunoffRisk;
    deteriorationTrend: RelationshipDeteriorationTrend;
    renewalProtectionRecommended: boolean;
  } | null;
}

// ─── Renewal Protection Assessment ──────────────────────────────────
export interface RenewalProtectionAssessment {
  runoffRisk: RelationshipRunoffRisk;
  deteriorationTrend: RelationshipDeteriorationTrend;
  treasuryStallRetentionRisk: boolean;
  protectionSeverity: RelationshipProtectionSeverity | null;
  renewalProtectionRecommended: boolean;
  openProtectionReasons: ProtectionReasonCode[];
}
```

### Hard Rule

These are all derived server-side only. No UI local derivation. No manual override of canonical protection status.

---

## Database Schema

### Migration: `supabase/migrations/20260630_relationship_protection_engine.sql`

```sql
-- =============================================================
-- Phase 65K.4 — Relationship Protection Engine
-- Depends: 20260530 (65K.1), 20260601 (65K.2), 20260615 (65K.3)
-- =============================================================

-- ─── 1. Protection Assessments ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_protection_assessments (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id                 uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                         uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  protection_status               text NOT NULL DEFAULT 'normal'
    CHECK (protection_status IN ('normal','watch','at_risk','active_case_open','stalled','resolved')),
  protection_severity             text
    CHECK (protection_severity IS NULL OR protection_severity IN ('low','medium','high','critical')),
  runoff_risk                     text NOT NULL DEFAULT 'unknown'
    CHECK (runoff_risk IN ('low','moderate','high','critical','unknown')),
  deterioration_trend             text NOT NULL DEFAULT 'unknown'
    CHECK (deterioration_trend IN ('unknown','stable','softening','deteriorating','accelerating')),
  treasury_stall_retention_risk   boolean NOT NULL DEFAULT false,
  renewal_protection_recommended  boolean NOT NULL DEFAULT false,

  open_reason_codes               text[] NOT NULL DEFAULT '{}',
  evidence                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  computation_version             text NOT NULL DEFAULT '65K.4',
  computed_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_protection_assessments_rel_time
  ON public.relationship_protection_assessments (relationship_id, computed_at DESC);
CREATE INDEX idx_rel_protection_assessments_bank_time
  ON public.relationship_protection_assessments (bank_id, computed_at DESC);
CREATE INDEX idx_rel_protection_assessments_status
  ON public.relationship_protection_assessments (protection_status, computed_at DESC);
CREATE INDEX idx_rel_protection_assessments_reasons_gin
  ON public.relationship_protection_assessments USING gin (open_reason_codes);

-- ─── 2. Protection Opportunities ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_protection_opportunities (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id         uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                 uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  opportunity_type        text NOT NULL
    CHECK (opportunity_type IN (
      'deposit_runoff_intervention','treasury_stall_intervention',
      'renewal_relationship_protection','relationship_recovery',
      'profitability_deterioration_review','borrower_reengagement'
    )),
  status                  text NOT NULL DEFAULT 'identified'
    CHECK (status IN (
      'identified','under_review','approved','case_open',
      'in_progress','resolved','declined','stalled','closed'
    )),
  severity                text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  confidence              text NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high','medium','low')),

  rationale               text NOT NULL,
  evidence                jsonb NOT NULL DEFAULT '{}'::jsonb,

  source_assessment_id    uuid REFERENCES public.relationship_protection_assessments(id) ON DELETE SET NULL,
  first_detected_at       timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at       timestamptz NOT NULL DEFAULT now(),
  closed_at               timestamptz
);

-- Only one open protection opportunity per type per relationship
CREATE UNIQUE INDEX uq_rel_protection_open_opportunity
  ON public.relationship_protection_opportunities (relationship_id, opportunity_type)
  WHERE closed_at IS NULL;

CREATE INDEX idx_rel_protection_opps_rel
  ON public.relationship_protection_opportunities (relationship_id);
CREATE INDEX idx_rel_protection_opps_bank_status
  ON public.relationship_protection_opportunities (bank_id, status);

-- ─── 3. Protection Cases ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_protection_cases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id             uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                     uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  opportunity_id              uuid NOT NULL REFERENCES public.relationship_protection_opportunities(id) ON DELETE CASCADE,

  status                      text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open','banker_review_required','ready',
      'borrower_outreach_open','in_progress',
      'resolved','stalled','closed'
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
CREATE UNIQUE INDEX uq_rel_protection_active_case
  ON public.relationship_protection_cases (opportunity_id)
  WHERE closed_at IS NULL;

CREATE INDEX idx_rel_protection_cases_rel
  ON public.relationship_protection_cases (relationship_id);
CREATE INDEX idx_rel_protection_cases_bank_status
  ON public.relationship_protection_cases (bank_id, status);

-- ─── 4. Protection Outcomes ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_protection_outcomes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protection_case_id    uuid NOT NULL REFERENCES public.relationship_protection_cases(id) ON DELETE CASCADE,
  relationship_id       uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id               uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  outcome_code          text NOT NULL
    CHECK (outcome_code IN (
      'runoff_risk_reduced','treasury_onboarding_recovered',
      'renewal_bundle_completed','borrower_reengaged',
      'relationship_stabilized','relationship_lost','no_change'
    )),
  summary               text NOT NULL,
  evidence              jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_protection_outcomes_case
  ON public.relationship_protection_outcomes (protection_case_id);
CREATE INDEX idx_rel_protection_outcomes_rel
  ON public.relationship_protection_outcomes (relationship_id, created_at DESC);

-- ─── 5. Protection Events Ledger ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_protection_events (
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

CREATE INDEX idx_rel_protection_events_rel_time
  ON public.relationship_protection_events (relationship_id, created_at DESC);
CREATE INDEX idx_rel_protection_events_code
  ON public.relationship_protection_events (event_code, created_at DESC);

-- ─── 6. RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.relationship_protection_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_protection_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_protection_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_protection_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_protection_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rel_protection_assessments_bank_isolation" ON public.relationship_protection_assessments
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_protection_opps_bank_isolation" ON public.relationship_protection_opportunities
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_protection_cases_bank_isolation" ON public.relationship_protection_cases
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_protection_outcomes_bank_isolation" ON public.relationship_protection_outcomes
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_protection_events_bank_isolation" ON public.relationship_protection_events
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
```

---

## Pure Functions

All pure functions: zero DB imports, deterministic, zero side effects, no Date.now unless injected.

### File: `src/core/relationship/protection/deriveRelationshipRunoffRisk.pure.ts`

```typescript
/**
 * Derives runoff risk from deposit capture deterioration, balance movement,
 * treasury signals, and relationship depth.
 */
export function deriveRelationshipRunoffRisk(
  input: RunoffRiskDerivationInput
): RelationshipRunoffRisk
```

**Input type:**
```typescript
interface RunoffRiskDerivationInput {
  depositCaptureStatus: DepositCaptureStatus;
  previousDepositCaptureStatus: DepositCaptureStatus | null;
  depositRunoffWatch: boolean;
  balanceTrendDirection: "increasing" | "stable" | "decreasing" | "unknown";
  relationshipDepth: RelationshipDepth;
  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  treasuryOnboardingStalled: boolean;
  relationshipValueTrend: RelationshipValueTrend;
  daysSinceLastBorrowerActivity: number | null;
}
```

**Rules:**
- `"unknown"` — insufficient evidence (no deposit data, no activity data)
- `"low"` — relationship stable, no deterioration signals, depth moderate+
- `"moderate"` — early softening: balanceTrend decreasing OR depth shallow with active treasury stall OR daysSinceLastActivity > 30
- `"high"` — clear deterioration: depositCaptureStatus regressed from previous OR (depositRunoffWatch AND depth shallow) OR multiple moderate signals
- `"critical"` — compounded signals: depositRunoffWatch AND balanceTrend decreasing AND (treasuryStalled OR valueTrend declining) AND depth shallow

### File: `src/core/relationship/protection/deriveRelationshipDeteriorationTrend.pure.ts`

```typescript
export function deriveRelationshipDeteriorationTrend(
  input: DeteriorationTrendDerivationInput
): RelationshipDeteriorationTrend
```

**Input type:**
```typescript
interface DeteriorationTrendDerivationInput {
  protectionAssessmentHistory: Array<{
    computedAt: string;
    runoffRisk: RelationshipRunoffRisk;
    protectionStatus: RelationshipProtectionStatus;
    openReasonCount: number;
  }>;
  relationshipValueTrend: RelationshipValueTrend;
  depositCaptureStatus: DepositCaptureStatus;
  previousDepositCaptureStatus: DepositCaptureStatus | null;
  minimumAssessmentsForTrend: number; // default 2
}
```

**Rules:**
- `"unknown"` — fewer than minimumAssessmentsForTrend assessments
- `"stable"` — no material change in runoff risk, reason count, or capture status
- `"softening"` — one signal worsening: runoff risk increased by one level OR one new reason code OR capture status regressed one step
- `"deteriorating"` — multiple signals worsening OR runoff risk jumped 2+ levels
- `"accelerating"` — deteriorating AND rate of change increasing (more reasons opening per assessment, or runoff risk worsening across consecutive windows)

### File: `src/core/relationship/protection/deriveProtectionReasons.pure.ts`

```typescript
export function deriveProtectionReasons(
  input: ProtectionReasonDerivationInput
): DerivedProtectionReason[]
```

**Input type:**
```typescript
interface ProtectionReasonDerivationInput {
  depositCaptureStatus: DepositCaptureStatus;
  previousDepositCaptureStatus: DepositCaptureStatus | null;
  depositRunoffWatch: boolean;
  treasuryOnboardingStalled: boolean;
  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  hasOpenRenewal: boolean;
  relationshipDepth: RelationshipDepth;
  relationshipValueTrend: RelationshipValueTrend;
  profitabilityBand: RelationshipProfitabilityBand;
  previousProfitabilityBand: RelationshipProfitabilityBand | null;
  daysSinceLastBorrowerActivity: number | null;
  borrowerDisengagementCount: number; // count of unresponded campaigns/items
}
```

**Detection rules:**
- `deposit_runoff_detected` (high) — depositRunoffWatch is true AND balances declining
- `deposit_capture_deteriorating` (medium) — capture status regressed from previous
- `treasury_onboarding_stalled` (medium) — treasuryOnboardingStalled AND adoption not active/multi_product
- `renewal_with_shallow_relationship` (high) — hasOpenRenewal AND depth shallow
- `relationship_value_declining` (medium) — valueTrend declining
- `profitability_deteriorating` (high) — profitabilityBand dropped materially from previous
- `borrower_disengagement_pattern` (medium) — borrowerDisengagementCount >= 3 OR daysSinceLastActivity > 60
- `relationship_depth_fragile` (low) — depth shallow AND treasuryAdoption < active AND capture < primary_captured
- `multi_signal_relationship_softening` (high) — 3+ medium reasons active simultaneously

### File: `src/core/relationship/protection/deriveRelationshipProtectionStatus.pure.ts`

```typescript
export function deriveRelationshipProtectionStatus(
  input: ProtectionStatusDerivationInput
): RelationshipProtectionStatus
```

**Rules (priority order):**
- `"stalled"` — any protection opportunity or case stale beyond threshold
- `"active_case_open"` — active protection case exists
- `"at_risk"` — any high/critical severity reason exists
- `"watch"` — one or more low/medium reasons
- `"resolved"` — recent case resolved AND no open reasons remain
- `"normal"` — no meaningful protection reasons

### File: `src/core/relationship/protection/deriveRelationshipProtectionSeverity.pure.ts`

```typescript
export function deriveRelationshipProtectionSeverity(
  reasons: DerivedProtectionReason[]
): RelationshipProtectionSeverity | null
```

**Rules:** Highest-severity open reason wins with stable enum tie-break. Returns null if no reasons.

### File: `src/core/relationship/protection/deriveProtectionOpportunities.pure.ts`

```typescript
export function deriveProtectionOpportunities(
  input: ProtectionOpportunityDerivationInput
): DerivedProtectionOpportunity[]
```

**Output type:**
```typescript
interface DerivedProtectionOpportunity {
  opportunityType: ProtectionOpportunityType;
  severity: RelationshipProtectionSeverity;
  confidence: "high" | "medium" | "low";
  rationale: string;
  evidence: Record<string, unknown>;
}
```

**Mapping rules:**
- Runoff signals → `deposit_runoff_intervention`
- Treasury stall with adoption incomplete → `treasury_stall_intervention`
- Renewal + shallow/fragile → `renewal_relationship_protection`
- Broad multi-signal deterioration → `relationship_recovery`
- Value collapse/profitability decline → `profitability_deterioration_review`
- Repeated non-response in key relationship packages → `borrower_reengagement`

**Hard rule:** No opportunity without structured evidence.

### File: `src/core/relationship/protection/deriveProtectionReadiness.pure.ts`

```typescript
export function deriveProtectionReadiness(
  input: ProtectionReadinessDerivationInput
): ProtectionReadiness
```

**Rules:**
- `"not_applicable"` — no current protection opportunity
- `"stalled"` — any opportunity or case stale beyond threshold
- `"active_case_open"` — active case exists
- `"ready"` — approved opportunities, no open case
- `"review_required"` — opportunities exist but banker review not completed
- `"resolved"` — recent case resolved and no open reasons remain

### File: `src/core/relationship/protection/deriveProtectionNextActions.pure.ts`

```typescript
export function deriveProtectionNextActions(
  input: ProtectionNextActionDerivationInput
): RelationshipNextAction[]
```

**Action mapping rules:**

| Condition | Action Code | Family | Blocking Party |
|---|---|---|---|
| Protection reasons exist, no review | `review_protection_risk` | `protect_relationship` | banker |
| Opportunity approved, no case | `open_protection_case` | `protect_relationship` | banker |
| Case open, next step pending | `advance_protection_case` | `protect_relationship` | banker |
| Treasury stall with retention risk | `recover_treasury_onboarding` | `protect_relationship` | banker |
| Runoff risk high/critical | `address_deposit_runoff` | `protect_relationship` | banker |
| Renewal + shallow/fragile | `prepare_renewal_protection_bundle` | `protect_relationship` | banker |
| Repeated disengagement | `reengage_borrower_relationship` | `protect_relationship` | banker |

### File: `src/core/relationship/protection/buildProtectionExplanations.pure.ts`

```typescript
export function buildProtectionExplanations(
  input: ProtectionExplanationInput
): string[]
```

Returns 1-4 human-readable strings. Examples:
- `"Deposit runoff detected — average daily balance declining over 3 months"`
- `"Treasury onboarding stalled for 21 days with retention implications"`
- `"Renewal approaching with shallow relationship — protection bundle recommended"`
- `"3 protection signals active: deposit deterioration, value decline, borrower disengagement"`

### File: `src/core/relationship/protection/buildRenewalProtectionAssessment.pure.ts`

```typescript
/**
 * Derives protection-aware renewal context. Returns null if no renewal is active.
 */
export function buildRenewalProtectionAssessment(
  input: RenewalProtectionAssessmentInput
): RenewalProtectionAssessment | null
```

**Rules:**
- Returns null if no open renewal
- `renewalProtectionRecommended` = true when runoffRisk is moderate+ AND (depth shallow OR deteriorationTrend worsening OR treasuryStallRetentionRisk)
- Higher-severity blocker suppresses the action but not the assessment data

### File: `src/core/relationship/protection/types.ts`

All protection-specific types. Zero runtime imports.

---

## Blocker Taxonomy Additions

Extend `RelationshipBlockerCode` from 65K.1 + 65K.2 + 65K.3:

```typescript
// Added in 65K.4
export type ProtectionBlockerCode =
  | "protection_review_required"
  | "protection_case_open"
  | "deposit_runoff_risk"
  | "renewal_relationship_protection_gap";
```

**Blocking party rules:**
- `protection_review_required` → banker
- `protection_case_open` → banker unless borrower package already open
- `deposit_runoff_risk` → banker by default; may become borrower if explicit borrower-owned package outstanding
- `renewal_relationship_protection_gap` → banker unless borrower-facing intervention already launched and waiting on borrower

**Priority:** Protection blockers rank above expansion blockers but below critical integrity failures, hard policy breaches, and highest-severity credit/monitoring/renewal obligations.

---

## Action Taxonomy Additions

Extend `RelationshipActionCode` from 65K.1 + 65K.2 + 65K.3:

```typescript
// Added in 65K.4
export type ProtectionActionCode =
  | "review_protection_risk"
  | "open_protection_case"
  | "advance_protection_case"
  | "recover_treasury_onboarding"
  | "address_deposit_runoff"
  | "prepare_renewal_protection_bundle"
  | "reengage_borrower_relationship";
```

---

## Event Taxonomy

### `relationship_protection_events.event_code` values:

```typescript
export type RelationshipProtectionEventCode =
  | "protection_assessment_computed"
  | "protection_status_changed"
  | "runoff_risk_changed"
  | "deterioration_trend_changed"
  | "protection_reason_opened"
  | "protection_reason_cleared"
  | "protection_opportunity_identified"
  | "protection_opportunity_closed"
  | "protection_opportunity_approved"
  | "protection_case_opened"
  | "protection_case_advanced"
  | "protection_case_stalled"
  | "protection_case_resolved"
  | "protection_outcome_recorded"
  | "renewal_protection_recommended";
```

**Hard rule:** Append-only. Corrections are new events.

---

## Protection Lifecycle

### Opportunity Transition Rules

| From | To | Trigger |
|---|---|---|
| `identified` | `under_review` | Surfaced for banker review |
| `under_review` | `approved` | Banker confirms |
| `approved` | `case_open` | Governed protection case opens |
| `case_open` | `in_progress` | Meaningful protection action begins |
| `in_progress` | `resolved` | Evidence-backed stabilization/recovery confirmed |
| any active state | `stalled` | Inactivity threshold breached |
| any active state | `declined` | Banker rejects intervention |
| terminal states | `closed` | Finalized |

### Case Transition Rules

| From | To | Trigger |
|---|---|---|
| `open` | `banker_review_required` | On creation if banker approval needed |
| `banker_review_required` | `ready` | Banker review completed |
| `ready` | `borrower_outreach_open` | Borrower-facing intervention launched |
| `ready` or `borrower_outreach_open` | `in_progress` | Meaningful work starts |
| `in_progress` | `resolved` | Banker-confirmed protection outcome achieved |
| any active state | `stalled` | No progress beyond threshold |
| active/resolved | `closed` | Finalization |

**Hard rule:** Protection completion is always evidence-backed and banker-confirmed.

---

## Renewal Protection Fusion

At renewal time, Buddy assesses not just credit readiness, depth, and expansion — but also:
- Runoff risk
- Deterioration trend
- Treasury stall retention risk
- Whether renewal should include a protection intervention

### Renewal protection recommendation rules

Recommend `renewal_relationship_protection` when:
- Renewal case open or due soon
- Runoff risk is moderate/high/critical
- Relationship depth is shallow OR deterioration trend is worsening
- Treasury adoption incomplete or stalled
- No higher-severity issue suppresses the action

**Hard rule:** This is a governed recommendation, not an automatic borrower-facing retention package.

---

## Server Orchestrators

### File: `src/core/relationship/protection/resolveRelationshipProtectionPack.ts`

```typescript
import "server-only";

/**
 * Server orchestrator. Extends the canonical pack with protection layer.
 * Never throws.
 */
export async function resolveRelationshipProtectionPack(
  relationshipId: string
): Promise<RelationshipProtectionPack>
```

**Steps:**
1. Fetch 65K.1 relationship canon + 65K.2 treasury/deposit + 65K.3 profitability/expansion
2. Fetch recent protection assessments (for trend)
3. Fetch open protection opportunities
4. Fetch open protection cases
5. Fetch renewal case context if applicable
6. Normalize into pure derivation inputs
7. Call pure functions: runoffRisk, deteriorationTrend, reasons, status, severity, opportunities, readiness, nextActions, explanations, renewalProtectionAssessment
8. Persist: protection assessment, upsert opportunities
9. Append events for material state changes
10. Return pack

### File: `src/core/relationship/protection/upsertRelationshipProtectionAssessment.ts`

```typescript
import "server-only";

/**
 * Computes and persists a protection assessment snapshot.
 * Immutable after insert.
 */
export async function upsertRelationshipProtectionAssessment(
  relationshipId: string,
  bankId: string
): Promise<void>
```

### File: `src/core/relationship/protection/upsertProtectionOpportunities.ts`

```typescript
import "server-only";

/**
 * Derives protection opportunities, upserts open ones (deduped by type),
 * closes opportunities no longer supported by evidence.
 */
export async function upsertProtectionOpportunities(
  relationshipId: string,
  bankId: string
): Promise<void>
```

### File: `src/core/relationship/protection/approveProtectionOpportunity.ts`

```typescript
import "server-only";

export async function approveProtectionOpportunity(
  opportunityId: string,
  approvedBy: string
): Promise<void>
```

### File: `src/core/relationship/protection/openProtectionCase.ts`

```typescript
import "server-only";

export async function openProtectionCase(
  opportunityId: string,
  openedBy: string
): Promise<{ caseId: string }>
```

### File: `src/core/relationship/protection/advanceProtectionCase.ts`

```typescript
import "server-only";

export async function advanceProtectionCase(
  caseId: string,
  newStatus: ProtectionCaseStatus,
  evidence: Record<string, unknown>,
  actorId: string
): Promise<void>
```

### File: `src/core/relationship/protection/resolveProtectionCase.ts`

```typescript
import "server-only";

/**
 * Resolves a protection case with structured evidence and records outcome.
 */
export async function resolveProtectionCase(
  caseId: string,
  outcomeCode: ProtectionOutcomeCode,
  summary: string,
  evidence: Record<string, unknown>,
  actorId: string
): Promise<void>
```

### File: `src/core/relationship/protection/recordProtectionOutcome.ts`

```typescript
import "server-only";

export async function recordProtectionOutcome(
  caseId: string,
  relationshipId: string,
  bankId: string,
  outcomeCode: ProtectionOutcomeCode,
  summary: string,
  evidence: Record<string, unknown>
): Promise<void>
```

### File: `src/core/relationship/protection/logRelationshipProtectionEvent.ts`

```typescript
import "server-only";

export async function logRelationshipProtectionEvent(
  input: {
    relationshipId: string;
    bankId: string;
    eventCode: RelationshipProtectionEventCode;
    actorType: "system" | "banker" | "borrower" | "cron";
    actorUserId?: string;
    payload?: Record<string, unknown>;
  }
): Promise<void>
```

---

## Orchestrator Extension

### Extend `resolveRelationshipCanonicalPack()` (from 65K.1, extended in 65K.2, 65K.3)

Updated flow:
1. Fetch 65K.1 relationship canon facts
2. Fetch 65K.2 deposit + treasury facts
3. Fetch 65K.3 profitability + expansion facts
4. Fetch recent protection assessments
5. Fetch protection opportunities + cases + outcomes
6. Fetch renewal case context if applicable
7. Normalize into pure input object
8. Run 65K.1 → 65K.2 → 65K.3 → 65K.4 pure chains
9. Merge blockers/actions using canonical priority rules
10. Persist assessments / opportunities / events
11. Return merged canonical pack

**Required behavior:**
- Never throws
- Canonical response still returns if protection persistence partially fails
- Projections remain rebuildable
- Exactly one primary relationship action still enforced

---

## Materialization / Rebuild Rules

### Protection assessments
- Persist new assessment when: status, severity, reason-code set, runoff risk, or deterioration trend changes
- Immutable after insert

### Protection opportunities
- Upsert by `(relationship_id, opportunity_type)`
- Refresh `last_confirmed_at` if still supported
- Close when evidence no longer supports them

### Protection cases
- One active case per opportunity
- Case required before material borrower-facing intervention
- Closing/resolving opportunity reconciles case

### Protection outcomes
- Write once when case resolved/closed materially
- Append-only

### Command center projection
- Protection actions outrank expansion actions
- Protection actions do not outrank hard integrity failures or highest-severity credit/monitoring/renewal obligations

---

## Borrower Experience

Borrowers never see: churn risk, runoff risk, profitability deterioration, relationship fragility score, retention intervention.

Borrowers may see: complete account setup, finish treasury setup, renewal preparation, update banking relationship information, complete follow-up items, finalize service activation.

### Borrower-safe package types
- `treasury_recovery_follow_up`
- `renewal_protection_bundle`
- `relationship_reengagement`
- `operating_account_follow_up`

---

## Command Center Extension

Do not create a second queue. Extend the same queue.

### New queue reason families
- `protection_review_required`
- `deposit_runoff_risk`
- `treasury_retention_stall`
- `renewal_protection_gap`
- `protection_case_open`
- `borrower_reengagement_required`

### Primary action priority rules

Protection actions rank:
1. Below hard integrity failures
2. Below highest-severity active monitoring/credit failures
3. At or above shallow renewal/review urgency when protection materially affects retention
4. Above profitability and expansion work
5. Above informational treasury/deposit review work

---

## API Surface

### `GET /api/relationships/[relationshipId]`
Extend response with `protectionPack: RelationshipProtectionPack`.

### `POST /api/relationships/[relationshipId]/refresh`
Now also refreshes protection assessment, opportunities, and renewal protection context.

### `GET /api/relationships/[relationshipId]/timeline`
Includes protection events from `relationship_protection_events`.

### `POST /api/relationships/[relationshipId]/protection-opportunities/[opportunityId]/approve`
**File:** `src/app/api/relationships/[relationshipId]/protection-opportunities/[opportunityId]/approve/route.ts`

### `POST /api/relationships/[relationshipId]/protection-opportunities/[opportunityId]/open-case`
**File:** `src/app/api/relationships/[relationshipId]/protection-opportunities/[opportunityId]/open-case/route.ts`

### `POST /api/relationships/[relationshipId]/protection-cases/[caseId]/advance`
**File:** `src/app/api/relationships/[relationshipId]/protection-cases/[caseId]/advance/route.ts`

### `POST /api/relationships/[relationshipId]/protection-cases/[caseId]/resolve`
**File:** `src/app/api/relationships/[relationshipId]/protection-cases/[caseId]/resolve/route.ts`

---

## Feature Flag

**File:** `src/lib/flags/relationshipOs.ts` (extend existing)

```typescript
export function isRelationshipProtectionEnabled(): boolean {
  return (
    isRelationshipOsEnabled() &&
    process.env.BUDDY_RELATIONSHIP_PROTECTION_ENABLED === "true"
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
| 3 | Unique open protection opportunity per type enforced |
| 4 | Unique active case per opportunity enforced |
| 5 | RLS enabled on all new tables |
| 6 | All indexes exist |
| 7 | Bank-scope integrity holds |
| 8 | Append-only event discipline preserved |

### B. Runoff + Deterioration Pure Functions (10 tests)

| # | Test |
|---|---|
| 9 | Runoff risk `unknown` with insufficient evidence |
| 10 | Runoff risk `low` |
| 11 | Runoff risk `moderate` |
| 12 | Runoff risk `high` |
| 13 | Runoff risk `critical` |
| 14 | Deterioration trend `unknown` |
| 15 | Deterioration trend `stable` |
| 16 | Deterioration trend `softening` |
| 17 | Deterioration trend `deteriorating` |
| 18 | Deterioration trend `accelerating` |

### C. Protection Reasons (10 tests)

| # | Test |
|---|---|
| 19 | Detects `deposit_runoff_detected` |
| 20 | Detects `deposit_capture_deteriorating` |
| 21 | Detects `treasury_onboarding_stalled` |
| 22 | Detects `renewal_with_shallow_relationship` |
| 23 | Detects `relationship_value_declining` |
| 24 | Detects `profitability_deteriorating` |
| 25 | Detects `borrower_disengagement_pattern` |
| 26 | Detects `relationship_depth_fragile` |
| 27 | Detects `multi_signal_relationship_softening` |
| 28 | Deterministic for same input |

### D. Protection Status + Severity (8 tests)

| # | Test |
|---|---|
| 29 | Status `normal` |
| 30 | Status `watch` |
| 31 | Status `at_risk` |
| 32 | Status `active_case_open` |
| 33 | Status `stalled` |
| 34 | Status `resolved` |
| 35 | Severity collapse picks highest |
| 36 | Deterministic for same input |

### E. Opportunity + Readiness Derivation (8 tests)

| # | Test |
|---|---|
| 37 | Derives deposit runoff intervention |
| 38 | Derives treasury stall intervention |
| 39 | Derives renewal protection opportunity |
| 40 | Derives relationship recovery |
| 41 | Derives borrower reengagement |
| 42 | Readiness `review_required` |
| 43 | Readiness `active_case_open` |
| 44 | Readiness `resolved` |

### F. Protection Actions (8 tests)

| # | Test |
|---|---|
| 45 | Maps to `review_protection_risk` |
| 46 | Maps to `open_protection_case` |
| 47 | Maps to `advance_protection_case` |
| 48 | Maps to `recover_treasury_onboarding` |
| 49 | Maps to `address_deposit_runoff` |
| 50 | Maps to `prepare_renewal_protection_bundle` |
| 51 | Maps to `reengage_borrower_relationship` |
| 52 | Protection actions outrank expansion actions |

### G. Case Lifecycle Integration (8 tests)

| # | Test |
|---|---|
| 53 | Approve opportunity |
| 54 | Open case |
| 55 | Advance case |
| 56 | Case cannot open twice |
| 57 | Resolve case requires structured evidence |
| 58 | Outcome recorded on resolve |
| 59 | Stalled case transitions correctly |
| 60 | Closed case cannot advance |

### H. Renewal Fusion Integration (6 tests)

| # | Test |
|---|---|
| 61 | Renewal protection assessment created when renewal exists |
| 62 | Runoff + shallow renewal recommends protection bundle |
| 63 | No bundle when relationship stable and deep |
| 64 | Higher-severity blocker suppresses protection action appropriately |
| 65 | Renewal protection recommendation updates when risk changes |
| 66 | Treasury stall retention risk included |

### I. Orchestrator Integration (7 tests)

| # | Test |
|---|---|
| 67 | Merged canonical pack includes protection fields |
| 68 | Partial persistence failure does not break canonical response |
| 69 | Opportunities upsert and close correctly |
| 70 | One primary action preserved |
| 71 | Timeline includes protection events |
| 72 | Refresh is idempotent |
| 73 | Projections rebuild correctly |

### J. Guard Tests (8 tests)

| # | Test |
|---|---|
| 74 | No DB imports in pure protection files |
| 75 | No `server-only` imports in pure files |
| 76 | No `Math.random` in pure files |
| 77 | No `fetch` in pure files |
| 78 | No UI local derivation of protection state |
| 79 | Protection completion requires banker evidence |
| 80 | Protection outranks expansion in action priority |
| 81 | Projection rebuildability preserved |

---

## File Manifest

```
src/core/relationship/protection/
  types.ts                                              — All protection types (zero runtime imports)
  deriveRelationshipRunoffRisk.pure.ts                  — Pure: runoff risk
  deriveRelationshipDeteriorationTrend.pure.ts          — Pure: deterioration trend
  deriveProtectionReasons.pure.ts                       — Pure: reason codes
  deriveRelationshipProtectionStatus.pure.ts            — Pure: protection status
  deriveRelationshipProtectionSeverity.pure.ts          — Pure: severity collapse
  deriveProtectionOpportunities.pure.ts                 — Pure: opportunity detection
  deriveProtectionReadiness.pure.ts                     — Pure: readiness
  deriveProtectionNextActions.pure.ts                   — Pure: action derivation
  buildProtectionExplanations.pure.ts                   — Pure: human-readable explanations
  buildRenewalProtectionAssessment.pure.ts              — Pure: renewal protection fusion
  resolveRelationshipProtectionPack.ts                  — Server orchestrator (server-only)
  upsertRelationshipProtectionAssessment.ts             — Server: persist assessment
  upsertProtectionOpportunities.ts                      — Server: upsert opportunities
  approveProtectionOpportunity.ts                       — Server: banker approval
  openProtectionCase.ts                                 — Server: open case
  advanceProtectionCase.ts                              — Server: advance case
  resolveProtectionCase.ts                              — Server: resolve with outcome
  recordProtectionOutcome.ts                            — Server: outcome persistence
  logRelationshipProtectionEvent.ts                     — Server: event ledger
  __tests__/
    deriveRelationshipRunoffRisk.test.ts
    deriveRelationshipDeteriorationTrend.test.ts
    deriveProtectionReasons.test.ts
    deriveRelationshipProtectionStatus.test.ts
    deriveProtectionOpportunities.test.ts
    deriveProtectionReadiness.test.ts
    protectionCaseLifecycle.integration.test.ts
    renewalProtectionFusion.integration.test.ts
    resolveRelationshipProtectionPack.integration.test.ts
    protectionGuard.test.ts

src/app/api/relationships/[relationshipId]/
  protection-opportunities/
    [opportunityId]/
      approve/
        route.ts                                         — POST banker approve
      open-case/
        route.ts                                         — POST open case
  protection-cases/
    [caseId]/
      advance/
        route.ts                                         — POST advance case
      resolve/
        route.ts                                         — POST resolve with outcome

supabase/migrations/
  20260630_relationship_protection_engine.sql             — Schema
```

---

## Acceptance Criteria

Phase 65K.4 is complete when:

1. Buddy can derive relationship runoff risk deterministically
2. Buddy can derive deterioration trend deterministically
3. Buddy can detect evidence-backed protection opportunities deterministically
4. Protection opportunities require banker review before governed action
5. Governed protection cases exist and are auditable
6. Renewal readiness includes protection context (runoff, deterioration, treasury stall)
7. Command center surfaces protection work in the same unified queue
8. Protection work outranks expansion but does not improperly outrank critical integrity/credit failures
9. All new tables are RLS-protected and auditable
10. 81+ tests pass (8 migration + 10 runoff/deterioration + 10 reasons + 8 status + 8 opportunity + 8 actions + 8 lifecycle + 6 renewal + 7 integration + 8 guards)
11. `tsc --noEmit` clean
12. No Omega/AI dependency — everything deterministic

---

## What This Phase Enables

After 65K.4, Buddy is no longer just a relationship operating system that can understand, operate, and grow the relationship. It becomes a system that can also **protect the relationship before deterioration becomes loss**.

The four layers are now complete:
- **65K.1** — Truth (canonical relationship state)
- **65K.2** — Operations (deposit + treasury workflows)
- **65K.3** — Growth (profitability + expansion)
- **65K.4** — Protection (runoff, deterioration, retention)

This creates the substrate for **65K.5** — Crypto Relationship Extension, which adds crypto collateral positions into the existing profitability, depth, protection, and monitoring canonical model.
