# Phase 65K.1 — Relationship Registry + Canonical Layer

## Status: Implementation Spec (Cursor-Ready)
## Depends On: Phase 65D (Canonical State), 65E (Execution), 65I (Monitoring), 65J (Annual Review/Renewal)
## Feature Flag: `BUDDY_RELATIONSHIP_OS_ENABLED` (default: false)

---

## Objective

Create a first-class `relationships` entity that sits above deals, monitoring programs, annual reviews, and renewals. Derive canonical relationship state, health, blocking party, explanations, and next actions — using the same doctrines as the deal-level canonical layer.

This phase does NOT build treasury lifecycle, expansion engine, or profitability engine. It builds the **canonical truth layer** that those systems will later read from.

---

## Architecture Decision

Reuse existing patterns exactly:

| Deal-Level (exists) | Relationship-Level (this phase) |
|---|---|
| `deriveLifecycleState()` | `deriveRelationshipState()` |
| `computeBlockers()` (pure) | `computeRelationshipBlockers()` (pure) |
| `getBuddyCanonicalState()` | `getBuddyCanonicalRelationshipState()` |
| `deriveNextActions()` (pure) | `deriveRelationshipNextActions()` (pure) |
| `deal_events` ledger | `relationship_events` ledger |
| `LifecycleStage` | `CanonicalRelationshipState` |
| `LifecycleBlocker` | `RelationshipBlocker` |

---

## Database Schema

### Migration: `supabase/migrations/20260530_relationship_registry.sql`

```sql
-- =============================================================
-- Phase 65K.1 — Relationship Registry + Canonical Layer
-- =============================================================

-- 1. Core relationship table
CREATE TABLE IF NOT EXISTS public.relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id         uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  borrower_id     uuid NOT NULL REFERENCES public.borrowers(id) ON DELETE CASCADE,

  -- Derived canonical state (written by server, never by client)
  canonical_state           text NOT NULL DEFAULT 'prospect',
  relationship_health       text NOT NULL DEFAULT 'stable',
  blocking_party            text NOT NULL DEFAULT 'none',

  -- Counters (denormalized for read performance, recomputed on derivation)
  active_deal_count               integer NOT NULL DEFAULT 0,
  active_loan_count               integer NOT NULL DEFAULT 0,
  open_monitoring_cycle_count     integer NOT NULL DEFAULT 0,
  open_annual_review_count        integer NOT NULL DEFAULT 0,
  open_renewal_count              integer NOT NULL DEFAULT 0,
  open_exception_count            integer NOT NULL DEFAULT 0,

  -- Deposit + treasury + profitability placeholders (Phase 65K.2+)
  deposit_relationship_status     text NOT NULL DEFAULT 'unknown',
  treasury_adoption_status        text NOT NULL DEFAULT 'none',
  profitability_status            text NOT NULL DEFAULT 'unknown',

  -- Risk
  risk_status               text NOT NULL DEFAULT 'normal',

  -- Next best action family
  next_best_action_family   text NOT NULL DEFAULT 'none',

  -- Explanation (server-derived, human-readable)
  explained_by              text[] NOT NULL DEFAULT '{}',

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  derived_at      timestamptz,  -- last canonical derivation

  UNIQUE(bank_id, borrower_id)
);

CREATE INDEX idx_relationships_bank ON public.relationships(bank_id);
CREATE INDEX idx_relationships_borrower ON public.relationships(borrower_id);
CREATE INDEX idx_relationships_state ON public.relationships(bank_id, canonical_state);
CREATE INDEX idx_relationships_health ON public.relationships(bank_id, relationship_health);

-- 2. Attach relationship_id to deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS relationship_id uuid REFERENCES public.relationships(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_relationship ON public.deals(relationship_id);

-- 3. Relationship state snapshots (time-series for audit + analytics)
CREATE TABLE IF NOT EXISTS public.relationship_state_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id           uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  canonical_state           text NOT NULL,
  relationship_health       text NOT NULL,
  blocking_party            text NOT NULL,
  risk_status               text NOT NULL,
  next_best_action_family   text NOT NULL,

  active_deal_count               integer NOT NULL DEFAULT 0,
  open_monitoring_cycle_count     integer NOT NULL DEFAULT 0,
  open_annual_review_count        integer NOT NULL DEFAULT 0,
  open_renewal_count              integer NOT NULL DEFAULT 0,
  open_exception_count            integer NOT NULL DEFAULT 0,

  explained_by      text[] NOT NULL DEFAULT '{}',
  blockers          jsonb NOT NULL DEFAULT '[]',
  next_actions      jsonb NOT NULL DEFAULT '[]',

  computed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_snapshots_rel ON public.relationship_state_snapshots(relationship_id, computed_at DESC);

-- 4. Relationship events ledger
CREATE TABLE IF NOT EXISTS public.relationship_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id           uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  deal_id           uuid REFERENCES public.deals(id) ON DELETE SET NULL,

  event_type        text NOT NULL,   -- e.g. 'relationship.created', 'relationship.state_changed', 'relationship.deal_linked'
  event_data        jsonb NOT NULL DEFAULT '{}',
  actor_id          text,            -- clerk user ID or 'system'
  actor_type        text NOT NULL DEFAULT 'system',  -- 'banker' | 'system' | 'borrower'

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rel_events_rel ON public.relationship_events(relationship_id, created_at DESC);
CREATE INDEX idx_rel_events_type ON public.relationship_events(event_type, created_at DESC);

-- 5. Relationship next actions (materialized for command center reads)
CREATE TABLE IF NOT EXISTS public.relationship_next_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id   uuid NOT NULL REFERENCES public.relationships(id) ON DELETE CASCADE,
  bank_id           uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  action_code       text NOT NULL,
  action_label      text NOT NULL,
  action_family     text NOT NULL,
  priority          integer NOT NULL DEFAULT 50,

  target_type       text,    -- 'deal' | 'monitoring' | 'annual_review' | 'renewal' | 'relationship'
  target_id         uuid,

  evidence          jsonb NOT NULL DEFAULT '{}',

  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz
);

CREATE INDEX idx_rel_actions_rel ON public.relationship_next_actions(relationship_id);
CREATE INDEX idx_rel_actions_bank ON public.relationship_next_actions(bank_id, action_family);

-- 6. Enable RLS
ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_state_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relationship_next_actions ENABLE ROW LEVEL SECURITY;

-- RLS policies (bank_id scoping)
CREATE POLICY "relationships_bank_isolation" ON public.relationships
  USING (bank_id = current_setting('app.bank_id', true)::uuid);

CREATE POLICY "rel_snapshots_bank_isolation" ON public.relationship_state_snapshots
  USING (bank_id = current_setting('app.bank_id', true)::uuid);

CREATE POLICY "rel_events_bank_isolation" ON public.relationship_events
  USING (bank_id = current_setting('app.bank_id', true)::uuid);

CREATE POLICY "rel_actions_bank_isolation" ON public.relationship_next_actions
  USING (bank_id = current_setting('app.bank_id', true)::uuid);
```

---

## Types

### File: `src/core/relationship/types.ts`

```typescript
// ─── Canonical Relationship State ───────────────────────────────────
export type CanonicalRelationshipState =
  | "prospect"
  | "intake_in_progress"
  | "credit_under_evaluation"
  | "credit_active"
  | "post_close_monitoring"
  | "annual_review_due"
  | "renewal_in_progress"
  | "relationship_expansion_ready"
  | "relationship_at_risk"
  | "watch"
  | "inactive"
  | "exited";

export type RelationshipHealth =
  | "strong"
  | "stable"
  | "fragile"
  | "deteriorating"
  | "critical";

export type RelationshipBlockingParty =
  | "banker"
  | "borrower"
  | "credit"
  | "portfolio"
  | "treasury"
  | "system"
  | "none";

export type RelationshipRiskStatus =
  | "normal"
  | "watch"
  | "exception_open"
  | "covenant_pressure"
  | "renewal_risk"
  | "deposit_runoff_risk";

export type RelationshipNextActionFamily =
  | "complete_credit_work"
  | "collect_borrower_items"
  | "resolve_exception"
  | "prepare_review"
  | "prepare_renewal"
  | "expand_relationship"
  | "protect_relationship"
  | "none";

// ─── Blocker ────────────────────────────────────────────────────────
export type RelationshipBlockerCode =
  | "no_active_deals"
  | "all_deals_stalled"
  | "monitoring_exceptions_unresolved"
  | "annual_review_overdue"
  | "renewal_overdue"
  | "multiple_deals_blocked"
  | "borrower_unresponsive"
  | "deposit_status_unknown"
  | "no_recent_activity";

export interface RelationshipBlocker {
  code: RelationshipBlockerCode;
  message: string;
  evidence?: Record<string, unknown>;
}

// ─── Next Action ────────────────────────────────────────────────────
export type RelationshipActionCode =
  | "advance_deal_credit"
  | "resolve_monitoring_exception"
  | "complete_annual_review"
  | "start_renewal_process"
  | "collect_borrower_documents"
  | "review_relationship_health"
  | "no_action_required";

export interface RelationshipNextAction {
  code: RelationshipActionCode;
  label: string;
  family: RelationshipNextActionFamily;
  priority: number; // 0 = highest
  targetType: "deal" | "monitoring" | "annual_review" | "renewal" | "relationship";
  targetId: string | null;
  evidence: Record<string, unknown>;
}

// ─── Derivation Input (pure function input) ─────────────────────────
export interface RelationshipDerivationInput {
  relationshipId: string;
  bankId: string;
  borrowerId: string;

  // Deal-level aggregates
  deals: Array<{
    dealId: string;
    lifecycleStage: string;
    blockerCount: number;
    blockingParty: string;
    isActive: boolean;
    hasPricingDecision: boolean;
    hasCommitteeDecision: boolean;
    urgencyBucket: string;
    createdAt: string;
    updatedAt: string;
  }>;

  // Monitoring aggregates
  monitoring: {
    activeProgramCount: number;
    openCycleCount: number;
    overdueCycleCount: number;
    openExceptionCount: number;
    criticalExceptionCount: number;
  };

  // Annual review aggregates
  annualReviews: {
    openCount: number;
    overdueCount: number;
    oldestDueAt: string | null;
  };

  // Renewal aggregates
  renewals: {
    openCount: number;
    overdueCount: number;
    nearestMaturityDate: string | null;
    nearestDueAt: string | null;
  };

  // Deposit (stub for 65K.1 — populated in 65K.2)
  depositStatus: "none" | "partial" | "primary_operating" | "deep" | "unknown";

  // Treasury (stub for 65K.1 — populated in 65K.2)
  treasuryAdoptionStatus: "none" | "recommended" | "proposed" | "in_onboarding" | "active" | "multi_product";

  // Activity
  lastActivityAt: string | null;
  daysSinceLastActivity: number | null;
}

// ─── Canonical Relationship Pack (output) ───────────────────────────
export interface CanonicalRelationshipPack {
  relationshipId: string;
  bankId: string;
  borrowerId: string;

  canonicalState: CanonicalRelationshipState;
  health: RelationshipHealth;
  blockingParty: RelationshipBlockingParty;
  riskStatus: RelationshipRiskStatus;
  nextBestActionFamily: RelationshipNextActionFamily;

  blockers: RelationshipBlocker[];
  nextActions: RelationshipNextAction[];
  explanations: string[];

  counters: {
    activeDealCount: number;
    activeLoanCount: number;
    openMonitoringCycleCount: number;
    openAnnualReviewCount: number;
    openRenewalCount: number;
    openExceptionCount: number;
  };

  derivedAt: string;
}
```

---

## Pure Functions

All pure functions live in `src/core/relationship/` and have **zero DB imports**.

### File: `src/core/relationship/deriveRelationshipState.pure.ts`

```typescript
/**
 * Pure function. Derives canonical relationship state from aggregated inputs.
 * No DB, no IO, no side effects.
 */
export function deriveCanonicalRelationshipState(
  input: RelationshipDerivationInput
): CanonicalRelationshipState
```

**State derivation rules (priority order — first match wins):**

1. `"exited"` — zero active deals, zero open monitoring, zero open reviews, zero open renewals, and relationship existed for > 90 days
2. `"inactive"` — zero active deals, no activity in 180+ days
3. `"watch"` — any critical exception OR any deal in `watch` stage
4. `"relationship_at_risk"` — multiple deals blocked + borrower unresponsive (no activity 30+ days) + open exceptions
5. `"renewal_in_progress"` — any open renewal case
6. `"annual_review_due"` — any open annual review case
7. `"post_close_monitoring"` — all deals past `committee_approved` + active monitoring program
8. `"credit_active"` — at least one deal with committee decision + no open reviews/renewals
9. `"credit_under_evaluation"` — at least one deal in `underwrite_ready` through `committee_ready`
10. `"intake_in_progress"` — at least one deal in `created` through `docs_satisfied`
11. `"relationship_expansion_ready"` — credit active + no blockers + deposit/treasury opportunity (65K.2 will refine)
12. `"prospect"` — fallback

### File: `src/core/relationship/deriveRelationshipHealth.pure.ts`

```typescript
export function deriveRelationshipHealth(
  input: RelationshipDerivationInput
): RelationshipHealth
```

**Rules:**
- `"critical"` — critical exceptions OR multiple overdue cycles + overdue renewal
- `"deteriorating"` — overdue annual review OR overdue monitoring cycles OR 60+ days no activity
- `"fragile"` — open exceptions OR all deals stalled OR borrower non-responsive 30+ days
- `"stable"` — active deals progressing, no overdue items
- `"strong"` — all deals healthy, no exceptions, monitoring current, reviews complete

### File: `src/core/relationship/computeRelationshipBlockers.pure.ts`

```typescript
/**
 * Pure function. Returns blockers for a relationship given its derived state.
 */
export function computeRelationshipBlockers(
  state: CanonicalRelationshipState,
  input: RelationshipDerivationInput
): RelationshipBlocker[]
```

**Blocker rules:**

| Code | Condition |
|---|---|
| `no_active_deals` | state not `prospect`/`exited`/`inactive` AND zero active deals |
| `all_deals_stalled` | all active deals have urgencyBucket `critical` |
| `monitoring_exceptions_unresolved` | `monitoring.openExceptionCount > 0` |
| `annual_review_overdue` | `annualReviews.overdueCount > 0` |
| `renewal_overdue` | `renewals.overdueCount > 0` |
| `multiple_deals_blocked` | 2+ deals with blockerCount > 0 |
| `borrower_unresponsive` | daysSinceLastActivity > 30 AND open items exist |
| `deposit_status_unknown` | state is `credit_active`+ AND deposit = `unknown` (warning only) |
| `no_recent_activity` | daysSinceLastActivity > 60 |

### File: `src/core/relationship/deriveRelationshipNextActions.pure.ts`

```typescript
export function deriveRelationshipNextActions(
  state: CanonicalRelationshipState,
  blockers: RelationshipBlocker[],
  input: RelationshipDerivationInput
): RelationshipNextAction[]
```

**Action derivation rules:**
- Each blocker maps to 1+ actionable next actions
- Actions are sorted by priority (0 = highest)
- Max 5 actions returned (most urgent)
- `no_action_required` if no blockers and state is healthy

### File: `src/core/relationship/deriveRelationshipBlockingParty.pure.ts`

```typescript
export function deriveRelationshipBlockingParty(
  blockers: RelationshipBlocker[],
  input: RelationshipDerivationInput
): RelationshipBlockingParty
```

**Rules:**
- `borrower_unresponsive` blocker → `"borrower"`
- `annual_review_overdue` or `renewal_overdue` → `"banker"` (banker owns outreach)
- `monitoring_exceptions_unresolved` → `"portfolio"`
- `all_deals_stalled` → derive from deal-level blocking parties
- No blockers → `"none"`

### File: `src/core/relationship/buildRelationshipExplanations.pure.ts`

```typescript
export function buildRelationshipExplanations(
  state: CanonicalRelationshipState,
  health: RelationshipHealth,
  blockers: RelationshipBlocker[],
  input: RelationshipDerivationInput
): string[]
```

Returns 1-5 human-readable explanation strings. Example:
- `"2 active deals in underwriting, 1 with borrower items outstanding"`
- `"Annual review for 2025 is 14 days overdue"`
- `"3 monitoring exceptions open (1 critical)"`

---

## Server Orchestrator

### File: `src/core/relationship/resolveRelationshipCanonicalPack.ts`

```typescript
import "server-only";

/**
 * Server orchestrator. Gathers inputs from DB, calls pure functions, persists results.
 * Modeled after getBuddyCanonicalState() in src/core/state/BuddyCanonicalStateAdapter.ts
 *
 * NEVER THROWS. Returns error state on infrastructure failure (fail-open).
 */
export async function resolveRelationshipCanonicalPack(
  relationshipId: string
): Promise<CanonicalRelationshipPack>
```

**Implementation steps:**

1. **Parallel DB reads** (same pattern as `deriveLifecycleState` lines 168-323):
   - `relationships` row (core record)
   - `deals` where `relationship_id = $1` AND stage != `exited` (active deals)
   - For each active deal: `getBuddyCanonicalState(dealId)` (batched, max 20 parallel)
   - `deal_monitoring_programs` + `deal_monitoring_cycles` (open/overdue counts)
   - `deal_monitoring_exceptions` (open/critical counts)
   - `deal_annual_reviews` where status NOT IN ('completed', 'waived')
   - `deal_renewal_cases` where status NOT IN ('completed', 'cancelled')
   - `relationship_events` (latest activity timestamp)

2. **Build `RelationshipDerivationInput`** from DB results

3. **Call pure functions** in sequence:
   ```
   state    = deriveCanonicalRelationshipState(input)
   health   = deriveRelationshipHealth(input)
   blockers = computeRelationshipBlockers(state, input)
   party    = deriveRelationshipBlockingParty(blockers, input)
   actions  = deriveRelationshipNextActions(state, blockers, input)
   explains = buildRelationshipExplanations(state, health, blockers, input)
   family   = actions[0]?.family ?? "none"
   ```

4. **Persist** (parallel):
   - UPDATE `relationships` SET canonical_state, health, blocking_party, risk_status, counters, explained_by, derived_at
   - INSERT into `relationship_state_snapshots`
   - DELETE + INSERT `relationship_next_actions` (replace materialized actions)

5. **Return** `CanonicalRelationshipPack`

---

## Relationship Lifecycle Management

### File: `src/core/relationship/ensureRelationship.ts`

```typescript
import "server-only";

/**
 * Ensures a relationship record exists for a bank+borrower pair.
 * Called when a deal is created or when a borrower is first seen.
 * Idempotent — uses UNIQUE(bank_id, borrower_id) with ON CONFLICT DO NOTHING.
 * Returns the relationship_id.
 */
export async function ensureRelationship(
  bankId: string,
  borrowerId: string
): Promise<string>
```

### File: `src/core/relationship/linkDealToRelationship.ts`

```typescript
import "server-only";

/**
 * Sets deals.relationship_id for a deal.
 * Called after ensureRelationship().
 * Emits 'relationship.deal_linked' event.
 */
export async function linkDealToRelationship(
  dealId: string,
  relationshipId: string
): Promise<void>
```

---

## API Routes

### `GET /api/relationships/[relationshipId]`

**File:** `src/app/api/relationships/[relationshipId]/route.ts`

```typescript
// Returns the canonical relationship pack.
// Calls resolveRelationshipCanonicalPack() on every read (self-healing, no stale cache).
// Auth: must be banker in same bank_id.
```

**Response shape:**
```json
{
  "ok": true,
  "relationship": { /* CanonicalRelationshipPack */ }
}
```

### `GET /api/relationships`

**File:** `src/app/api/relationships/route.ts`

```typescript
// Lists relationships for the current bank.
// Query params: ?state=credit_active&health=fragile&limit=50&offset=0
// Returns lightweight rows (no full pack — use /[id] for that).
// Auth: must be banker in bank.
```

**Response shape:**
```json
{
  "ok": true,
  "relationships": [
    {
      "id": "...",
      "borrower_id": "...",
      "borrower_name": "...",
      "canonical_state": "credit_active",
      "relationship_health": "stable",
      "blocking_party": "none",
      "active_deal_count": 2,
      "open_exception_count": 0,
      "next_best_action_family": "none",
      "derived_at": "..."
    }
  ],
  "total": 142
}
```

### `POST /api/relationships/[relationshipId]/refresh`

**File:** `src/app/api/relationships/[relationshipId]/refresh/route.ts`

```typescript
// Forces a re-derivation of relationship canonical state.
// Used by command center, cron, or manual banker trigger.
// Returns the fresh CanonicalRelationshipPack.
```

### `GET /api/relationships/[relationshipId]/timeline`

**File:** `src/app/api/relationships/[relationshipId]/timeline/route.ts`

```typescript
// Returns unified timeline from relationship_events + deal_events for linked deals.
// Query params: ?limit=50&before=<timestamp>
```

---

## Integration Points

### 1. Deal Creation Hook

In `src/lib/intake/orchestrateIntake.ts` (or wherever deals are created):

```typescript
// After deal + borrower creation:
if (isRelationshipOsEnabled()) {
  const relId = await ensureRelationship(bankId, borrowerId);
  await linkDealToRelationship(dealId, relId);
}
```

### 2. Backfill Script

```typescript
// src/scripts/backfillRelationships.ts
// One-time migration: for each (bank_id, borrower_id) pair in deals,
// create a relationship record and set deals.relationship_id.
// Idempotent, safe to re-run.
```

### 3. Command Center Extension (Phase 65K.1 scope — minimal)

Add to `buildBankerQueueSurface.ts`:
- When `BUDDY_RELATIONSHIP_OS_ENABLED`, include a `relationship_id` and `relationship_health` on each queue row
- No new queue item families yet (that's 65K.3+)

### 4. Feature Flag

**File:** `src/lib/flags/relationshipOs.ts`

```typescript
export function isRelationshipOsEnabled(): boolean {
  return process.env.BUDDY_RELATIONSHIP_OS_ENABLED === "true";
}
```

---

## Test Plan

### Pure Function Tests (unit, no DB)

**File:** `src/core/relationship/__tests__/deriveRelationshipState.test.ts`

| Test | Assertion |
|---|---|
| Prospect with no deals | state = `prospect` |
| One deal in intake | state = `intake_in_progress` |
| One deal in underwriting | state = `credit_under_evaluation` |
| One deal approved, monitoring active | state = `post_close_monitoring` |
| Annual review open | state = `annual_review_due` |
| Renewal open | state = `renewal_in_progress` |
| Critical exception | state = `watch` |
| Zero deals, old relationship | state = `exited` |
| Multiple signals — priority order | highest-priority state wins |

**File:** `src/core/relationship/__tests__/computeRelationshipBlockers.test.ts`

| Test | Assertion |
|---|---|
| No blockers when healthy | `[]` |
| Exception open → blocker emitted | code = `monitoring_exceptions_unresolved` |
| Annual review overdue → blocker | code = `annual_review_overdue` |
| Renewal overdue → blocker | code = `renewal_overdue` |
| Multiple deals blocked | code = `multiple_deals_blocked` with evidence |
| Borrower inactive 30+ days | code = `borrower_unresponsive` |
| 60+ day inactivity | code = `no_recent_activity` |

**File:** `src/core/relationship/__tests__/deriveRelationshipHealth.test.ts`

| Test | Assertion |
|---|---|
| All healthy | `strong` |
| Open exceptions | `fragile` |
| Overdue review + overdue cycles | `deteriorating` |
| Critical exceptions + overdue renewal | `critical` |
| Active deals, no issues | `stable` |

**File:** `src/core/relationship/__tests__/deriveRelationshipNextActions.test.ts`

| Test | Assertion |
|---|---|
| No blockers → `no_action_required` | single action |
| Annual review overdue → prepare_review action | family = `prepare_review` |
| Exception open → resolve_exception action | family = `resolve_exception` |
| Max 5 actions returned | truncated |
| Priority ordering | highest priority first |

### Integration Tests

**File:** `src/core/relationship/__tests__/resolveRelationshipCanonicalPack.integration.test.ts`

| Test | Assertion |
|---|---|
| Fresh relationship resolves without error | pack returned |
| Relationship with 2 deals aggregates correctly | counters match |
| Persistence writes to relationships table | SELECT confirms update |
| Snapshot inserted | relationship_state_snapshots row exists |
| Infrastructure failure → fail-open | pack returned with error state |

### Guard Tests

**File:** `src/core/relationship/__tests__/relationshipGuard.test.ts`

| # | Guard | Assertion |
|---|---|---|
| 1 | Pure functions have no DB imports | `grep` for supabase/server-only in pure files = 0 |
| 2 | Types file has no runtime imports | import count = 0 |
| 3 | Feature flag gates all integration points | `ensureRelationship` checks flag |
| 4 | State derivation is deterministic | same input → same output (100 iterations) |
| 5 | Blocker codes are all documented | every code in type union has a test |
| 6 | resolveRelationshipCanonicalPack never throws | try/catch wraps everything |
| 7 | Migration has RLS enabled | grep for ENABLE ROW LEVEL SECURITY |
| 8 | No Math.random/Date.now in pure files | institutional determinism requirement |

---

## File Manifest

```
src/core/relationship/
  types.ts                                    — All types (zero runtime imports)
  deriveRelationshipState.pure.ts             — Pure: state derivation
  deriveRelationshipHealth.pure.ts            — Pure: health derivation
  computeRelationshipBlockers.pure.ts         — Pure: blocker computation
  deriveRelationshipBlockingParty.pure.ts     — Pure: blocking party
  deriveRelationshipNextActions.pure.ts       — Pure: next actions
  buildRelationshipExplanations.pure.ts       — Pure: human-readable explanations
  resolveRelationshipCanonicalPack.ts         — Server orchestrator (server-only)
  ensureRelationship.ts                       — Server: create/get relationship
  linkDealToRelationship.ts                   — Server: link deal
  __tests__/
    deriveRelationshipState.test.ts
    deriveRelationshipHealth.test.ts
    computeRelationshipBlockers.test.ts
    deriveRelationshipNextActions.test.ts
    resolveRelationshipCanonicalPack.integration.test.ts
    relationshipGuard.test.ts

src/app/api/relationships/
  route.ts                                    — GET list
  [relationshipId]/
    route.ts                                  — GET canonical pack
    refresh/
      route.ts                                — POST re-derive
    timeline/
      route.ts                                — GET unified timeline

src/lib/flags/
  relationshipOs.ts                           — Feature flag

src/scripts/
  backfillRelationships.ts                    — One-time backfill

supabase/migrations/
  20260530_relationship_registry.sql          — Schema
```

---

## Acceptance Criteria

1. `relationships` table exists with UNIQUE(bank_id, borrower_id) and RLS
2. `deals.relationship_id` FK exists
3. `resolveRelationshipCanonicalPack()` returns correct state for: prospect, intake, underwriting, active, monitoring, review, renewal, watch, at-risk, exited
4. All pure functions pass determinism guards (no DB, no randomness, no Date.now)
5. Feature flag `BUDDY_RELATIONSHIP_OS_ENABLED=false` means zero behavior change to existing system
6. Backfill script links all existing deals to relationships
7. API routes return correct shapes with auth enforcement
8. 40+ unit tests pass, 5+ integration tests pass, 8 guard tests pass
9. `tsc --noEmit` clean
10. No new Omega/AI dependency — everything is deterministic

---

## What This Phase Does NOT Build

- Treasury lifecycle states or product tracking (65K.2)
- Deposit operationalization beyond status placeholder (65K.2)
- Profitability engine (65K.3)
- Expansion opportunity detection (65K.3)
- Protection cases (65K.4)
- Crypto collateral monitoring (65K.5)
- Relationship-level command center queue items (65K.3)
- Borrower-facing relationship packages (65K.2+)

These all depend on the canonical layer built here.
