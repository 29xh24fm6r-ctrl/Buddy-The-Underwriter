# Phase 65K.2 — Deposit + Treasury Operationalization
## Status: Spec — Ready for implementation after 65K.1 merge
## Depends On: Phase 65K.1 (Relationship Registry + Canonical Layer)
## Feature Flag: `BUDDY_RELATIONSHIP_OS_ENABLED` + `BUDDY_RELATIONSHIP_TREASURY_ENABLED` (both required)

---

## Objective

Operationalize deposit and treasury relationship intelligence on top of the 65K.1 relationship canonical layer.

Phase 65K.2 converts deposit and treasury from analytical outputs into:
- governed relationship workflows
- canonical relationship sub-states
- banker-reviewable operational cases
- borrower-safe onboarding packages
- command-center-visible actions

This phase does **not** build the full expansion engine, profitability engine, or crypto extension.
It establishes the operating rails those later phases will use.

---

## Why This Phase Exists

65K.1 made the relationship a first-class canonical object.

65K.2 makes the relationship **operationally useful** beyond credit by answering:

- Do we have the primary operating account?
- Do we have meaningful deposit depth?
- Which treasury products are actually recommended?
- Has treasury been reviewed internally?
- Has a package been presented?
- Is onboarding underway?
- Is onboarding stalled?
- What should the banker do next?

Without this phase, Buddy knows the relationship exists.
With this phase, Buddy starts to **run the relationship**.

---

## Product Goal

Buddy should become the system that operationally manages:
- operating account capture
- deposit relationship depth
- treasury product recommendation
- treasury review
- treasury proposal packaging
- treasury onboarding progress
- treasury onboarding delay detection

This phase must remain deterministic, auditable, borrower-safe, server-derived, and rebuildable.

---

## Scope

### Included
- Relationship-level deposit state derivation
- Relationship-level treasury adoption state derivation
- Treasury opportunity registry
- Treasury package creation + lifecycle
- Treasury onboarding tracking
- Borrower-safe treasury package orchestration (reuses Phase 65F)
- Command center extension for treasury/deposit actions
- Relationship timeline events for treasury/deposit transitions
- Canonical pack extension with deposit + treasury fields
- Deterministic action derivation for treasury/deposit workflows

### Explicitly Out of Scope
- Profitability bands and pricing strategy (65K.3)
- Full relationship expansion scoring engine (65K.3)
- Autonomous cross-sell recommendation engine (65K.3)
- Crypto collateral relationship extension (65K.5)
- Advanced treasury revenue analytics
- Banker compensation / sales workflows
- CRM pipeline abstractions

---

## Core Doctrine

1. Deposit and treasury states are derived server-side only.
2. Treasury recommendations are evidence-backed operational suggestions, not CRM notes.
3. Banker review is required before borrower-facing package launch.
4. Borrower activity does not equal treasury completion.
5. Treasury onboarding completion requires banker-reviewed evidence.
6. Projection tables remain rebuildable.
7. Borrowers never see internal language: cross-sell, wallet share, relationship capture, product penetration.
8. Relationship canon remains primary; deposit and treasury are relationship dimensions, not standalone systems.
9. Omega may explain treasury context later, but may not determine operational state.
10. All lifecycle transitions require structured evidence and ledger events.

---

## Canonical Layer Extensions

Extend the 65K.1 relationship canonical pack with deposit and treasury dimensions.

### New Types

```ts
// ─── Deposit Types ──────────────────────────────────────────────────
export type DepositRelationshipStatus =
  | "none"
  | "partial"
  | "primary_operating"
  | "deep"
  | "unknown";

export type DepositCaptureStatus =
  | "not_started"
  | "signals_detected"
  | "partial_capture"
  | "primary_captured"
  | "deepened"
  | "at_risk";

// ─── Treasury Types ─────────────────────────────────────────────────
export type TreasuryAdoptionStatus =
  | "none"
  | "recommended"
  | "under_review"
  | "proposed"
  | "in_onboarding"
  | "active"
  | "multi_product"
  | "stalled";

export type TreasuryPackageStatus =
  | "not_created"
  | "draft"
  | "banker_review_required"
  | "ready_to_send"
  | "sent"
  | "borrower_engaged"
  | "completed"
  | "stalled"
  | "closed";

export type TreasuryProductType =
  | "lockbox"
  | "ach_origination"
  | "positive_pay"
  | "sweep_account"
  | "remote_deposit_capture"
  | "operating_account_migration";

export type TreasuryProductLifecycleState =
  | "identified"
  | "under_review"
  | "approved"
  | "proposed"
  | "borrower_interested"
  | "implementation_requested"
  | "onboarding_in_progress"
  | "active"
  | "declined"
  | "stalled"
  | "closed";

// ─── Canonical Pack Extension ───────────────────────────────────────
export interface RelationshipTreasuryDepositPack {
  depositRelationshipStatus: DepositRelationshipStatus;
  depositCaptureStatus: DepositCaptureStatus;

  treasuryAdoptionStatus: TreasuryAdoptionStatus;
  activeTreasuryOpportunityCount: number;
  activeTreasuryProductCount: number;

  treasuryPackageStatus: TreasuryPackageStatus | null;
  treasuryOnboardingOpen: boolean;
  treasuryOnboardingStalled: boolean;

  primaryOperatingAccountConfidence: "high" | "medium" | "low" | "unknown";
  depositRunoffWatch: boolean;
}
```

### Hard Rule

These are derived fields. No client may infer them. No UI may compute them locally.

---

## Database Schema

### Migration: `supabase/migrations/20260601_relationship_treasury_deposit.sql`

```sql
-- =============================================================
-- Phase 65K.2 — Deposit + Treasury Operationalization
-- Depends: 20260530_relationship_registry.sql (65K.1)
-- =============================================================

-- ─── 1. Relationship Deposit Profiles ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_deposit_profiles (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id                     uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                             uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  average_daily_balance               numeric,
  average_month_end_balance           numeric,
  volatility_score                    numeric,
  seasonal_pattern                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  low_balance_periods                 jsonb NOT NULL DEFAULT '[]'::jsonb,

  primary_operating_account_confidence text NOT NULL DEFAULT 'unknown'
    CHECK (primary_operating_account_confidence IN ('high','medium','low','unknown')),
  deposit_relationship_status         text NOT NULL DEFAULT 'unknown'
    CHECK (deposit_relationship_status IN ('none','partial','primary_operating','deep','unknown')),
  deposit_capture_status              text NOT NULL DEFAULT 'not_started'
    CHECK (deposit_capture_status IN ('not_started','signals_detected','partial_capture','primary_captured','deepened','at_risk')),
  deposit_runoff_watch                boolean NOT NULL DEFAULT false,

  evidence                            jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at                         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_deposit_profiles_rel_time
  ON public.relationship_deposit_profiles (relationship_id, computed_at DESC);
CREATE INDEX idx_rel_deposit_profiles_bank_time
  ON public.relationship_deposit_profiles (bank_id, computed_at DESC);
CREATE INDEX idx_rel_deposit_profiles_status
  ON public.relationship_deposit_profiles (deposit_relationship_status, deposit_capture_status);

-- ─── 2. Treasury Opportunities ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_treasury_opportunities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id       uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id               uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  opportunity_type      text NOT NULL
    CHECK (opportunity_type IN (
      'lockbox','ach_origination','positive_pay',
      'sweep_account','remote_deposit_capture','operating_account_migration'
    )),
  recommended           boolean NOT NULL DEFAULT true,
  status                text NOT NULL DEFAULT 'identified'
    CHECK (status IN (
      'identified','under_review','approved','proposed',
      'accepted','declined','stalled','closed'
    )),

  confidence            text NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high','medium','low')),
  evidence              jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale             text NOT NULL,

  source_snapshot_id    uuid REFERENCES public.relationship_state_snapshots(id) ON DELETE SET NULL,

  first_detected_at     timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at     timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz
);

-- Only one open opportunity per type per relationship
CREATE UNIQUE INDEX uq_rel_treasury_open_opportunity
  ON public.relationship_treasury_opportunities (relationship_id, opportunity_type)
  WHERE closed_at IS NULL;

CREATE INDEX idx_rel_treasury_opps_rel
  ON public.relationship_treasury_opportunities (relationship_id);
CREATE INDEX idx_rel_treasury_opps_bank_status
  ON public.relationship_treasury_opportunities (bank_id, status);

-- ─── 3. Treasury Packages ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_treasury_packages (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id             uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                     uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  status                      text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft','banker_review_required','ready_to_send',
      'sent','borrower_engaged','completed','stalled','closed'
    )),
  package_version             integer NOT NULL DEFAULT 1,

  recommended_products        jsonb NOT NULL DEFAULT '[]'::jsonb,
  borrower_safe_summary       jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_notes              jsonb NOT NULL DEFAULT '[]'::jsonb,

  banker_review_required      boolean NOT NULL DEFAULT true,
  banker_review_completed_at  timestamptz,
  banker_review_completed_by  text,

  borrower_campaign_id        uuid,
  sent_at                     timestamptz,
  completed_at                timestamptz,
  stalled_at                  timestamptz,
  closed_at                   timestamptz,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_treasury_packages_rel_time
  ON public.relationship_treasury_packages (relationship_id, created_at DESC);
CREATE INDEX idx_rel_treasury_packages_bank_status
  ON public.relationship_treasury_packages (bank_id, status);

-- ─── 4. Treasury Product States ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_treasury_product_states (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id         uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id                 uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  product_type            text NOT NULL
    CHECK (product_type IN (
      'lockbox','ach_origination','positive_pay',
      'sweep_account','remote_deposit_capture','operating_account_migration'
    )),
  lifecycle_state         text NOT NULL DEFAULT 'identified'
    CHECK (lifecycle_state IN (
      'identified','under_review','approved','proposed',
      'borrower_interested','implementation_requested',
      'onboarding_in_progress','active','declined','stalled','closed'
    )),

  source_opportunity_id   uuid REFERENCES public.relationship_treasury_opportunities(id) ON DELETE SET NULL,
  package_id              uuid REFERENCES public.relationship_treasury_packages(id) ON DELETE SET NULL,

  evidence                jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at            timestamptz,
  closed_at               timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Only one active product state per type per relationship
CREATE UNIQUE INDEX uq_rel_treasury_active_product
  ON public.relationship_treasury_product_states (relationship_id, product_type)
  WHERE closed_at IS NULL;

CREATE INDEX idx_rel_treasury_products_rel
  ON public.relationship_treasury_product_states (relationship_id);
CREATE INDEX idx_rel_treasury_products_bank_state
  ON public.relationship_treasury_product_states (bank_id, lifecycle_state);

-- ─── 5. Treasury Events Ledger ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.relationship_treasury_events (
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

CREATE INDEX idx_rel_treasury_events_rel_time
  ON public.relationship_treasury_events (relationship_id, created_at DESC);
CREATE INDEX idx_rel_treasury_events_code
  ON public.relationship_treasury_events (event_code, created_at DESC);

-- ─── 6. RLS ─────────────────────────────────────────────────────────

ALTER TABLE public.relationship_deposit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_treasury_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_treasury_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_treasury_product_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_treasury_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rel_deposit_profiles_bank_isolation" ON public.relationship_deposit_profiles
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_treasury_opps_bank_isolation" ON public.relationship_treasury_opportunities
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_treasury_packages_bank_isolation" ON public.relationship_treasury_packages
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_treasury_products_bank_isolation" ON public.relationship_treasury_product_states
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
CREATE POLICY "rel_treasury_events_bank_isolation" ON public.relationship_treasury_events
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
```

---

## Pure Functions

All pure functions: zero DB imports, deterministic, zero side effects, no Date.now unless injected.

### File: `src/core/relationship/treasury/deriveDepositRelationshipStatus.pure.ts`

```typescript
/**
 * Derives the deposit relationship depth from normalized deposit evidence.
 * Wraps and extends the existing buildDepositProfile() output.
 */
export function deriveDepositRelationshipStatus(
  input: DepositDerivationInput
): DepositRelationshipStatus
```

**Input type:**
```typescript
interface DepositDerivationInput {
  averageDailyBalance: number | null;
  volatilityScore: number | null;
  seasonalPattern: "CONSISTENT" | "SEASONAL" | "VOLATILE" | "INSUFFICIENT_DATA";
  creditSignals: string[];
  lowBalancePeriodCount: number;
  hasOperatingAccountIndicators: boolean;
  hasRecurringPayrollActivity: boolean;
  hasRecurringVendorPayments: boolean;
  monthsOfData: number;
}
```

**Rules (priority order):**
- `"unknown"` — monthsOfData < 3 OR averageDailyBalance is null
- `"none"` — averageDailyBalance < 5_000 AND no operating indicators AND no recurring activity
- `"partial"` — some balance evidence but no strong operating indicators
- `"primary_operating"` — hasOperatingAccountIndicators AND (hasRecurringPayrollActivity OR hasRecurringVendorPayments) AND averageDailyBalance >= 25_000
- `"deep"` — primary_operating conditions met AND averageDailyBalance >= 100_000 AND seasonalPattern in (CONSISTENT, SEASONAL) AND lowBalancePeriodCount <= 1

### File: `src/core/relationship/treasury/deriveDepositCaptureStatus.pure.ts`

```typescript
export function deriveDepositCaptureStatus(
  input: DepositCaptureDerivationInput
): DepositCaptureStatus
```

**Input type:**
```typescript
interface DepositCaptureDerivationInput {
  depositRelationshipStatus: DepositRelationshipStatus;
  previousDepositRelationshipStatus: DepositRelationshipStatus | null;
  hasOperatingAccountMigrationStarted: boolean;
  balanceTrendDirection: "increasing" | "stable" | "decreasing" | "unknown";
  daysSinceLastDepositProfileCompute: number | null;
}
```

**Rules:**
- `"not_started"` — depositRelationshipStatus is `none` or `unknown`, no migration started
- `"signals_detected"` — depositRelationshipStatus is `partial`, no migration started
- `"partial_capture"` — migration started OR depositRelationshipStatus progressed from `none`/`unknown`
- `"primary_captured"` — depositRelationshipStatus is `primary_operating`
- `"deepened"` — depositRelationshipStatus is `deep`
- `"at_risk"` — previousStatus was `primary_operating` or `deep` BUT current is lower, OR balanceTrendDirection is `decreasing`

### File: `src/core/relationship/treasury/deriveTreasuryOpportunities.pure.ts`

```typescript
/**
 * Produces evidence-backed treasury opportunity recommendations.
 * Wraps and extends the existing generateTreasuryProposals() primitive.
 */
export function deriveTreasuryOpportunities(
  input: TreasuryOpportunityDerivationInput
): DerivedTreasuryOpportunity[]
```

**Input type:**
```typescript
interface TreasuryOpportunityDerivationInput {
  // From existing generateTreasuryProposals() inputs
  avgDailyBalance: number | null;
  accountsReceivable: number | null;
  grossReceipts: number | null;
  salariesWages: number | null;
  depositVolatility: number | null;
  naicsCode: string | null;

  // Extended for relationship context
  depositRelationshipStatus: DepositRelationshipStatus;
  hasExternalPrimaryBank: boolean;
  existingTreasuryProducts: TreasuryProductType[];
}
```

**Output type:**
```typescript
interface DerivedTreasuryOpportunity {
  opportunityType: TreasuryProductType;
  confidence: "high" | "medium" | "low";
  rationale: string;
  evidence: Record<string, unknown>;
}
```

**Rules:**
- Delegates to `generateTreasuryProposals()` for base recommendations
- Adds `operating_account_migration` when `hasExternalPrimaryBank` AND depositRelationshipStatus is `none` or `partial`
- Filters out already-active products (`existingTreasuryProducts`)
- Elevates confidence when multiple supporting signals converge
- Does not create opportunities without evidence

### File: `src/core/relationship/treasury/deriveTreasuryAdoptionStatus.pure.ts`

```typescript
export function deriveTreasuryAdoptionStatus(
  input: TreasuryAdoptionDerivationInput
): TreasuryAdoptionStatus
```

**Input type:**
```typescript
interface TreasuryAdoptionDerivationInput {
  opportunityCount: number;
  activeProductCount: number;
  onboardingProductCount: number;
  packageStatus: TreasuryPackageStatus | null;
  bankerReviewCompleted: boolean;
  hasStaleOnboarding: boolean;
}
```

**Rules (priority order):**
- `"stalled"` — hasStaleOnboarding is true
- `"multi_product"` — activeProductCount >= 2
- `"active"` — activeProductCount === 1
- `"in_onboarding"` — onboardingProductCount > 0
- `"proposed"` — packageStatus in (`sent`, `borrower_engaged`)
- `"under_review"` — packageStatus is `banker_review_required` OR (opportunities exist AND bankerReviewCompleted is false)
- `"recommended"` — opportunityCount > 0 AND no package AND no active products
- `"none"` — opportunityCount === 0 AND activeProductCount === 0

### File: `src/core/relationship/treasury/deriveTreasuryNextActions.pure.ts`

```typescript
export function deriveTreasuryNextActions(
  input: TreasuryNextActionDerivationInput
): RelationshipNextAction[]
```

**Action mapping rules:**

| Condition | Action Code | Family | Blocking Party |
|---|---|---|---|
| Deposit signals exist, no banker review | `review_deposit_relationship` | `expand_relationship` | banker |
| Opportunities exist, no package drafted | `review_treasury_opportunities` | `expand_relationship` | banker |
| Package in `banker_review_required` | `complete_treasury_review` | `expand_relationship` | banker |
| Package in `ready_to_send` | `launch_treasury_package` | `expand_relationship` | banker |
| Package `sent`, borrower engagement stale | `follow_up_treasury_package` | `collect_borrower_items` | borrower |
| Onboarding in progress | `advance_treasury_onboarding` | `expand_relationship` | banker |
| Package or onboarding stalled | `resolve_treasury_stall` | `protect_relationship` | banker |

### File: `src/core/relationship/treasury/buildTreasuryExplanations.pure.ts`

```typescript
export function buildTreasuryExplanations(
  input: TreasuryExplanationInput
): string[]
```

Returns 1-3 human-readable strings. Examples:
- `"3 treasury products recommended based on operating cash flow patterns"`
- `"Treasury package sent 12 days ago, borrower has not engaged"`
- `"Lockbox and ACH Origination active; Positive Pay onboarding in progress"`

### File: `src/core/relationship/treasury/types.ts`

All treasury/deposit-specific types. Zero runtime imports.

---

## Blocker Taxonomy Additions

Extend `RelationshipBlockerCode` from 65K.1:

```typescript
// Added in 65K.2
export type TreasuryDepositBlockerCode =
  | "deposit_relationship_review_required"
  | "treasury_review_required"
  | "treasury_package_outstanding"
  | "treasury_onboarding_open"
  | "treasury_onboarding_stalled";
```

**Blocking party rules:**
- `deposit_relationship_review_required` → banker
- `treasury_review_required` → banker
- `treasury_package_outstanding` → borrower or banker depending on package status
- `treasury_onboarding_open` → banker or borrower based on open item ownership
- `treasury_onboarding_stalled` → banker (unless explicit borrower evidence)

**Severity:** Treasury/deposit blockers are always lower priority than credit, monitoring, and renewal blockers. They cannot suppress critical monitoring exceptions, renewal urgency, annual review urgency, or relationship integrity failures.

---

## Action Taxonomy Additions

Extend `RelationshipActionCode` from 65K.1:

```typescript
// Added in 65K.2
export type TreasuryDepositActionCode =
  | "review_deposit_relationship"
  | "review_treasury_opportunities"
  | "complete_treasury_review"
  | "launch_treasury_package"
  | "follow_up_treasury_package"
  | "advance_treasury_onboarding"
  | "resolve_treasury_stall";
```

---

## Event Taxonomy

### `relationship_treasury_events.event_code` values:

```typescript
export type RelationshipTreasuryEventCode =
  | "deposit_profile_computed"
  | "deposit_status_changed"
  | "deposit_capture_status_changed"
  | "treasury_opportunity_identified"
  | "treasury_opportunity_closed"
  | "treasury_package_created"
  | "treasury_package_approved"
  | "treasury_package_sent"
  | "treasury_package_stalled"
  | "treasury_package_completed"
  | "treasury_package_closed"
  | "treasury_product_state_changed"
  | "treasury_onboarding_started"
  | "treasury_onboarding_completed";
```

**Hard rule:** Events are append-only. Corrections are new events.

---

## Treasury Package Lifecycle

### States

```
draft → banker_review_required → ready_to_send → sent → borrower_engaged → completed
                                                    ↘ stalled                    ↘ closed
                                                 sent → stalled
                                    borrower_engaged → stalled
```

### Transition Rules

| From | To | Trigger |
|---|---|---|
| `draft` | `banker_review_required` | Package first generated |
| `banker_review_required` | `ready_to_send` | Banker explicitly approves |
| `ready_to_send` | `sent` | Orchestration launches borrower package |
| `sent` | `borrower_engaged` | Borrower opens/uploads/responds meaningfully |
| `borrower_engaged` | `completed` | Banker-reviewed evidence confirms onboarding steps complete |
| `sent` or `borrower_engaged` | `stalled` | Inactivity threshold breached (14 days default) |
| any active state | `closed` | Superseded, declined, withdrawn, or completed+finalized |

**Hard rule:** Borrower interaction never directly marks package completed. Banker evidence review is always required.

---

## Server Orchestrators

### File: `src/core/relationship/treasury/resolveRelationshipTreasuryDepositPack.ts`

```typescript
import "server-only";

/**
 * Server orchestrator. Extends resolveRelationshipCanonicalPack() with
 * treasury/deposit derivation. Never throws.
 */
export async function resolveRelationshipTreasuryDepositPack(
  relationshipId: string
): Promise<RelationshipTreasuryDepositPack>
```

**Steps:**
1. Fetch latest `relationship_deposit_profiles` for relationship
2. Fetch open `relationship_treasury_opportunities`
3. Fetch latest `relationship_treasury_packages` (open/active)
4. Fetch active `relationship_treasury_product_states`
5. Normalize into pure derivation inputs
6. Call `deriveDepositRelationshipStatus()`, `deriveDepositCaptureStatus()`
7. Call `deriveTreasuryAdoptionStatus()`
8. Call `deriveTreasuryNextActions()`, `buildTreasuryExplanations()`
9. Persist deposit profile snapshot
10. Return pack

### File: `src/core/relationship/treasury/upsertRelationshipDepositProfile.ts`

```typescript
import "server-only";

/**
 * Computes deposit profile from available bank statement / financial data,
 * using existing buildDepositProfile() primitive, then persists to
 * relationship_deposit_profiles and emits treasury event.
 */
export async function upsertRelationshipDepositProfile(
  relationshipId: string,
  bankId: string
): Promise<void>
```

### File: `src/core/relationship/treasury/upsertTreasuryOpportunities.ts`

```typescript
import "server-only";

/**
 * Derives treasury opportunities using deriveTreasuryOpportunities(),
 * upserts to relationship_treasury_opportunities (deduped by type),
 * closes opportunities no longer supported by evidence.
 */
export async function upsertTreasuryOpportunities(
  relationshipId: string,
  bankId: string
): Promise<void>
```

### File: `src/core/relationship/treasury/createOrRefreshTreasuryPackageDraft.ts`

```typescript
import "server-only";

/**
 * Creates a new treasury package draft from approved opportunities.
 * Only one open package per relationship at a time.
 * Uses existing buildRelationshipDistributionPackage() for borrower-safe content.
 */
export async function createOrRefreshTreasuryPackageDraft(
  relationshipId: string,
  bankId: string
): Promise<{ packageId: string }>
```

### File: `src/core/relationship/treasury/approveTreasuryPackage.ts`

```typescript
import "server-only";

/**
 * Banker approves package for borrower delivery.
 * Transitions: banker_review_required → ready_to_send.
 * Records banker identity and timestamp.
 */
export async function approveTreasuryPackage(
  packageId: string,
  approvedBy: string
): Promise<void>
```

### File: `src/core/relationship/treasury/launchTreasuryPackage.ts`

```typescript
import "server-only";

/**
 * Launches borrower-facing treasury package using Phase 65F orchestration.
 * Creates borrower_request_campaign with treasury_onboarding items.
 * Transitions: ready_to_send → sent.
 */
export async function launchTreasuryPackage(
  packageId: string,
  launchedBy: string
): Promise<{ campaignId: string }>
```

### File: `src/core/relationship/treasury/advanceTreasuryProductLifecycle.ts`

```typescript
import "server-only";

/**
 * Advances a single treasury product's lifecycle state.
 * Validates transition legality, persists, emits event.
 */
export async function advanceTreasuryProductLifecycle(
  productStateId: string,
  newState: TreasuryProductLifecycleState,
  evidence: Record<string, unknown>,
  actorId: string
): Promise<void>
```

### File: `src/core/relationship/treasury/detectTreasuryStall.ts`

```typescript
import "server-only";

/**
 * Detects stalled treasury packages and onboarding.
 * Called by cron/tempo processor.
 * Transitions stale packages to 'stalled' state.
 * Default stall threshold: 14 days of inactivity.
 */
export async function detectTreasuryStall(
  bankId: string
): Promise<{ stalledCount: number }>
```

### File: `src/core/relationship/treasury/logRelationshipTreasuryEvent.ts`

```typescript
import "server-only";

/**
 * Appends to relationship_treasury_events ledger.
 */
export async function logRelationshipTreasuryEvent(
  input: {
    relationshipId: string;
    bankId: string;
    eventCode: RelationshipTreasuryEventCode;
    actorType: "system" | "banker" | "borrower" | "cron";
    actorUserId?: string;
    payload?: Record<string, unknown>;
  }
): Promise<void>
```

---

## Orchestrator Extension

### Extend `resolveRelationshipCanonicalPack()` (from 65K.1)

Updated flow:
1. Fetch relationship core facts
2. Fetch latest deposit profile inputs / source metrics
3. Fetch treasury opportunities
4. Fetch treasury package rows
5. Fetch treasury product states
6. Normalize into pure input object
7. Run existing 65K.1 pure chain
8. Run treasury/deposit pure derivation chain
9. Merge treasury/deposit blockers + actions into canonical pack
10. Persist treasury/deposit projections
11. Append ledger events
12. Return canonical pack

**Required behavior:**
- Never throws
- Canonical relationship response still returns if treasury projection persistence fails
- Treasury/deposit materialization is best-effort but auditable
- Relationship truth remains readable even when package/projected rows are stale

---

## Materialization / Rebuild Rules

### Source of truth
Truth lives in: relationship facts, normalized deposit evidence, treasury package facts, treasury product state facts, pure derivation functions.

Truth does NOT live in: command center projections, UI state, borrower campaign state alone.

### Treasury opportunities
- Upsert open opportunities by `(relationship_id, opportunity_type)`
- Refresh `last_confirmed_at` when still supported
- Close opportunities when evidence no longer supports them

### Treasury packages
- Only one open active package per relationship
- New package version created only when product recommendations materially change after prior package is closed or superseded

### Product states
- One active open lifecycle row per `(relationship_id, product_type)`
- Transitions append events
- Status changes do not mutate history away

### Command center projection
- Relationship next actions fully rebuilt on refresh
- Treasury actions merged into same relationship action projection
- Still exactly one primary action per relationship

---

## Borrower Orchestration

Reuse Phase 65F borrower orchestration (`createBorrowerCampaign()`).

### New borrower-safe package types
- `treasury_onboarding`
- `operating_account_migration`
- `treasury_follow_up`

### Borrower-facing language

**Allowed:**
- Streamline receivables
- Automate payments
- Protect against fraud
- Optimize idle balances
- Simplify deposits
- Complete treasury setup

**Forbidden:**
- Cross-sell
- Product penetration
- Relationship capture
- Profitability uplift
- Wallet share

---

## Command Center Extension

Do not create a second queue. Extend the unified queue.

### New queue reason families
- `deposit_relationship_review`
- `treasury_review_required`
- `treasury_package_ready`
- `treasury_package_follow_up`
- `treasury_onboarding_open`
- `treasury_onboarding_stalled`

### Queue row requirements
Each treasury/deposit row must answer:
- Why this needs attention now
- Whether this is banker-owned or borrower-owned
- What evidence supports the row
- What action is available now
- What happens if nothing happens

### Primary action selection
Treasury actions may become primary only when they outrank other relationship actions by blocker severity, canonical state urgency, overdue age, and stable enum order. Treasury work must never suppress critical monitoring exceptions, renewal urgency, annual review urgency, or relationship integrity failures.

---

## API Surface

### `GET /api/relationships/[relationshipId]`
Extend response with `treasuryDepositPack: RelationshipTreasuryDepositPack`.

### `POST /api/relationships/[relationshipId]/refresh`
Now also refreshes deposit derivation, treasury opportunities, and treasury adoption status.

### `GET /api/relationships/[relationshipId]/timeline`
Includes treasury/deposit events from `relationship_treasury_events`.

### `POST /api/relationships/[relationshipId]/treasury-package`
**File:** `src/app/api/relationships/[relationshipId]/treasury-package/route.ts`

Create or refresh package draft from current approved opportunities.

### `POST /api/relationships/[relationshipId]/treasury-package/[packageId]/approve`
**File:** `src/app/api/relationships/[relationshipId]/treasury-package/[packageId]/approve/route.ts`

Banker review approval. Auth: must be banker in same bank.

### `POST /api/relationships/[relationshipId]/treasury-package/[packageId]/launch`
**File:** `src/app/api/relationships/[relationshipId]/treasury-package/[packageId]/launch/route.ts`

Launch borrower package using orchestration layer. Auth: must be banker in same bank.

### `GET /api/relationships/[relationshipId]/treasury/opportunities`
**File:** `src/app/api/relationships/[relationshipId]/treasury/opportunities/route.ts`

List open treasury opportunities for relationship.

### `GET /api/relationships/[relationshipId]/treasury/products`
**File:** `src/app/api/relationships/[relationshipId]/treasury/products/route.ts`

List active treasury product states for relationship.

---

## Feature Flag

**File:** `src/lib/flags/relationshipOs.ts` (extend existing)

```typescript
export function isRelationshipTreasuryEnabled(): boolean {
  return (
    isRelationshipOsEnabled() &&
    process.env.BUDDY_RELATIONSHIP_TREASURY_ENABLED === "true"
  );
}
```

---

## Test Plan

### A. Migration + Constraints (8 tests)

| # | Test |
|---|---|
| 1 | All 5 new tables created |
| 2 | All status CHECK constraints enforced |
| 3 | Unique open treasury opportunity per type enforced |
| 4 | Unique active product state per type enforced |
| 5 | Package status constraints enforced |
| 6 | RLS enabled on all new tables |
| 7 | relationship_id + bank_id FK discipline holds |
| 8 | All indexes exist |

### B. Deposit Pure Functions (8 tests)

| # | Test |
|---|---|
| 9 | Derives `none` |
| 10 | Derives `partial` |
| 11 | Derives `primary_operating` |
| 12 | Derives `deep` |
| 13 | Derives `unknown` |
| 14 | Derives capture `signals_detected` |
| 15 | Derives capture `primary_captured` |
| 16 | Derives capture `at_risk` |

### C. Treasury Opportunity Derivation (8 tests)

| # | Test |
|---|---|
| 17 | Identifies lockbox from receivables evidence |
| 18 | Identifies ACH origination from payment flow evidence |
| 19 | Identifies Positive Pay from fraud-control evidence |
| 20 | Identifies sweep from idle-balance evidence |
| 21 | Identifies RDC from deposit pattern evidence |
| 22 | Identifies operating account migration from account-location evidence |
| 23 | Does not create unsupported opportunities |
| 24 | Deterministic for same input |

### D. Treasury Adoption Derivation (7 tests)

| # | Test |
|---|---|
| 25 | `none` with no activity |
| 26 | `recommended` with opportunity only |
| 27 | `under_review` with banker review pending |
| 28 | `proposed` when package sent |
| 29 | `in_onboarding` when accepted and open |
| 30 | `active` with one active product |
| 31 | `multi_product` with multiple active products |

### E. Treasury Next Actions (8 tests)

| # | Test |
|---|---|
| 32 | Review deposit relationship |
| 33 | Review treasury opportunities |
| 34 | Complete treasury review |
| 35 | Launch treasury package |
| 36 | Follow up treasury package |
| 37 | Advance treasury onboarding |
| 38 | Resolve treasury stall |
| 39 | No treasury action when not applicable |

### F. Package Lifecycle Integration (8 tests)

| # | Test |
|---|---|
| 40 | Create package draft |
| 41 | Approve package |
| 42 | Launch package |
| 43 | Borrower engagement changes state |
| 44 | Borrower activity does NOT auto-complete |
| 45 | Banker completion required |
| 46 | Stale package moves to stalled |
| 47 | Closed package cannot relaunch |

### G. Orchestrator Integration (7 tests)

| # | Test |
|---|---|
| 48 | Canonical refresh returns merged deposit/treasury pack |
| 49 | Treasury persistence failure does not break canonical response |
| 50 | Opportunity upsert dedupes correctly |
| 51 | Next actions rebuilt with exactly one primary action |
| 52 | Treasury events emitted on package transitions |
| 53 | Stale treasury onboarding detected |
| 54 | Timeline includes treasury events |

### H. Guard Tests (8 tests)

| # | Test |
|---|---|
| 55 | No DB imports in pure treasury/deposit files |
| 56 | No `server-only` in pure files |
| 57 | No `Math.random` in pure files |
| 58 | No `fetch` in pure files |
| 59 | No UI local derivation of treasury/deposit state |
| 60 | No borrower completion bypass (package lifecycle) |
| 61 | Append-only event discipline |
| 62 | Projection rebuildability preserved |

---

## File Manifest

```
src/core/relationship/treasury/
  types.ts                                          — All treasury/deposit types (zero runtime imports)
  deriveDepositRelationshipStatus.pure.ts           — Pure: deposit status
  deriveDepositCaptureStatus.pure.ts                — Pure: capture status
  deriveTreasuryOpportunities.pure.ts               — Pure: opportunity detection
  deriveTreasuryAdoptionStatus.pure.ts              — Pure: adoption status
  deriveTreasuryNextActions.pure.ts                 — Pure: action derivation
  buildTreasuryExplanations.pure.ts                 — Pure: human-readable explanations
  resolveRelationshipTreasuryDepositPack.ts         — Server orchestrator (server-only)
  upsertRelationshipDepositProfile.ts               — Server: persist deposit profile
  upsertTreasuryOpportunities.ts                    — Server: upsert opportunities
  createOrRefreshTreasuryPackageDraft.ts             — Server: package draft
  approveTreasuryPackage.ts                          — Server: banker approval
  launchTreasuryPackage.ts                           — Server: launch to borrower
  advanceTreasuryProductLifecycle.ts                 — Server: product state transitions
  detectTreasuryStall.ts                             — Server: stall detection (cron)
  logRelationshipTreasuryEvent.ts                    — Server: event ledger
  __tests__/
    deriveDepositRelationshipStatus.test.ts
    deriveDepositCaptureStatus.test.ts
    deriveTreasuryOpportunities.test.ts
    deriveTreasuryAdoptionStatus.test.ts
    deriveTreasuryNextActions.test.ts
    treasuryPackageLifecycle.integration.test.ts
    resolveRelationshipTreasuryDepositPack.integration.test.ts
    treasuryGuard.test.ts

src/app/api/relationships/[relationshipId]/
  treasury-package/
    route.ts                                         — POST create/refresh draft
    [packageId]/
      approve/
        route.ts                                     — POST banker approve
      launch/
        route.ts                                     — POST launch to borrower
  treasury/
    opportunities/
      route.ts                                       — GET list opportunities
    products/
      route.ts                                       — GET list product states

supabase/migrations/
  20260601_relationship_treasury_deposit.sql          — Schema
```

---

## Acceptance Criteria

Phase 65K.2 is complete when:

1. Buddy can derive deposit relationship depth deterministically
2. Buddy can derive treasury adoption status deterministically
3. Buddy can register evidence-backed treasury opportunities
4. Banker review is required before borrower-facing treasury package launch
5. Borrower treasury packages are orchestrated through the existing 65F borrower system
6. Treasury onboarding cannot complete without banker-reviewed evidence
7. Command center surfaces treasury/deposit work in the same unified queue
8. Treasury/deposit actions remain subordinate to higher-severity risk/review work
9. All new tables are RLS-protected and auditable
10. 62+ tests pass (8 migration + 8 deposit + 8 opportunity + 7 adoption + 8 actions + 8 lifecycle + 7 integration + 8 guards)
11. `tsc --noEmit` clean
12. No Omega/AI dependency — everything deterministic

---

## What This Phase Enables

After 65K.2, Buddy is no longer just a lending lifecycle operating system. It becomes a relationship operating system that can manage deposits and treasury operationally, not just analytically. This creates the substrate for:

- **65K.3** — Profitability engine can read treasury adoption + deposit depth to compute relationship value bands
- **65K.3** — Expansion engine can read deposit + treasury gaps to detect deterministic growth opportunities
- **65K.4** — Protection engine can detect treasury onboarding stalls and deposit runoff as risk signals
