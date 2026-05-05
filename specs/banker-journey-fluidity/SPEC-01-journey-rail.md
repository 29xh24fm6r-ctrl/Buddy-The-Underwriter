# SPEC-01 — Banker Journey Rail

**Path:** `specs/banker-journey-fluidity/SPEC-01-journey-rail.md`
**Status:** Ready for Claude Code
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** `main`
**Depends on:** `src/buddy/lifecycle/*` (already shipped — do not modify)
**Related:** `specs/phase-underwriting-pipeline-rail.md` (sub-stage rail; this spec wraps and supersedes it for the full arc)

---

## Problem in one paragraph

The lifecycle infrastructure is excellent (`src/buddy/lifecycle/model.ts` defines 11 canonical stages with deterministic blockers and `getNextAction()` per stage), but the UI does not surface it as a journey. A banker landing on `/deals/[id]/cockpit` sees five stacked navigation paradigms simultaneously: 18-tab `DealShell` strip, `IntelligencePanel`, `InsightPanel`, 3-column Keystone layout, and `SecondaryTabsPanel` with another 5-7 tabs. There is no "you are here" and no "next." The 11-stage canonical sequence — `intake_created` → `docs_requested` → `docs_in_progress` → `docs_satisfied` → `underwrite_ready` → `underwrite_in_progress` → `committee_ready` → `committee_decisioned` → `closing_in_progress` → `closed` — exists in code but is never shown to the banker as a single coherent path.

## Solution in one paragraph

Introduce one persistent **`<JourneyRail>`** component, vertical-left, rendered above every banker-facing deal surface (deal list rows, cockpit, underwrite, committee, decision, closing). The rail is the canonical navigation: it shows all 11 stages, highlights the current one, displays the one next action inline, and shows blockers as one-line explanations on locked stages. Click any reachable stage → jump there. Every other navigation surface (`DealShell` tabs, `SecondaryTabsPanel`) collapses to either reference utilities (Documents, Financials) or retires entirely.

## PIV — Pre-Implementation Verification

Before writing code, Claude Code must confirm:

1. **`src/buddy/lifecycle/model.ts`** still exports `LIFECYCLE_STAGES`, `STAGE_LABELS`, `ALLOWED_STAGE_TRANSITIONS`, `LifecycleStage` type. (Read the file fresh, do not assume.)
2. **`src/buddy/lifecycle/nextAction.ts`** still exports `getNextAction(state, dealId): NextAction` and `getBlockerFixAction(blocker, dealId): FixAction | null`.
3. **`GET /api/deals/[dealId]/lifecycle`** returns `{ ok: boolean, state: LifecycleState }` (never 500). Read `src/app/api/deals/[dealId]/lifecycle/route.ts` to confirm shape.
4. **`useCockpitDataContext()`** in `src/buddy/cockpit/useCockpitData.ts` already exposes `lifecycleState` — JourneyRail consumes from this context inside cockpit, and from a one-shot fetch on other surfaces.
5. **Test deal `0279ed32-c25c-4919-b231-5790050331dd`** (Samaritus Yacht Management, stage=`underwriting`) is reachable. All UI verification is done against this deal.

If any of these is missing or has changed shape, **STOP** and surface to Matt before proceeding. Do not invent replacements.

---

## Scope

### In scope

- Create new component `src/components/journey/JourneyRail.tsx` (and supporting subcomponents in `src/components/journey/`).
- Create new component `src/components/journey/JourneyMiniRail.tsx` (compact 11-dot variant for deal list rows).
- Create new hook `src/hooks/useJourneyState.ts` (wraps `/api/deals/[dealId]/lifecycle` with SWR-style cache + 30s revalidation).
- Wire `JourneyRail` into `src/app/(app)/deals/[dealId]/layout.tsx` (replaces the 18-tab strip in `DealShell`).
- Wire `JourneyMiniRail` into `src/app/(app)/deals/page.tsx` (replaces the legacy stage column string).
- Reduce `DealShell` tab strip to ≤4 utility tabs: `Documents`, `Financials`, `Risk`, `Relationship`. All other stage-specific tabs (`Builder`, `Underwrite`, `Committee`, `Credit Memo`, `Borrower`, `Feasibility`, `Portal`, `Post-Close`, `Reviews`, `Special Assets`, `SBA Package`, `Classic Spreads`) become deep-links from the rail; their routes remain accessible by URL but are no longer on the tab strip.
- Add E2E test `e2e/journey-rail.spec.ts` covering the four stage transitions a banker actually hits in the test deal.
- Delete `SecondaryTabsPanel` mounting from `DealCockpitClient.tsx` (file stays for now — gated retirement in SPEC-02).

### Out of scope (covered by sibling specs)

- **SPEC-02 — Cockpit collapse.** Replaces the 3-column Keystone layout + `SecondaryTabsPanel` with stage-driven mode views. Ships after SPEC-01 lands.
- **SPEC-03 — Committee uplift.** Hoists `CommitteeStudioClient` recommendation panel + readiness checklist into the rail's Decision mode. Ships after SPEC-02.
- **SPEC-04 — `next_action_json` canonicalization.** Persists JourneyRail state into `deals.next_action_json` so email/Slack/voice all read from one place. Ships independently.
- Any change to `src/buddy/lifecycle/*` — the lifecycle engine is the contract this spec consumes. Do not modify.
- Any change to `LIFECYCLE_STAGES` ordering or labels.

### Hard non-goals

- **Do not** introduce a new state machine. The rail reads `LifecycleState`. Period.
- **Do not** add wizard-style "Next" / "Back" buttons that auto-advance. Stage advancement remains driven by `POST /api/deals/[dealId]/lifecycle/advance` and `/lifecycle/action`. The rail surfaces what to do; the existing endpoints execute.
- **Do not** hide stages the deal hasn't reached — show all 11, with locked stages dimmed and reasoned.

---

## Component contracts

### `JourneyRail` — full vertical rail

**File:** `src/components/journey/JourneyRail.tsx`

```typescript
import type { LifecycleState, LifecycleStage } from "@/buddy/lifecycle/model";

type Props = {
  dealId: string;
  /**
   * Optional initial state. If provided, JourneyRail renders immediately
   * without flash. If omitted, rail fetches via useJourneyState.
   * Cockpit passes this from server-derived state; standalone surfaces omit it.
   */
  initialState?: LifecycleState;
  /**
   * Layout variant. "vertical" (default) is the canonical workspace rail.
   * "horizontal" is reserved for narrow viewports / embedded contexts only.
   */
  variant?: "vertical" | "horizontal";
  /**
   * Optional className for outer container. Do not use for layout-breaking styles;
   * the rail is sized internally.
   */
  className?: string;
};

export function JourneyRail(props: Props): JSX.Element;
```

**Visual contract — vertical variant:**

```
┌─────────────────────────────────┐
│  Samaritus Yacht Management     │  ← deal name (from useCockpitDataContext or prop)
│  $2.4M · SBA 7(a)               │
├─────────────────────────────────┤
│  ✓  1  Deal Created             │  ← passed stage (emerald, no action)
│  │                              │
│  ✓  2  Documents Requested      │
│  │                              │
│  ●  3  Collecting Documents     │  ← current stage (blue, active dot, action button)
│  │     7 of 12 documents        │
│  │     [Review Documents →]     │
│  │                              │
│  ○  4  Documents Complete       │  ← reachable (gray, no action yet)
│  │                              │
│  ⊘  5  Ready for Underwriting   │  ← locked
│  │     Needs: pricing assumptions
│  │                              │
│  ⊘  6  Underwriting             │
│  │                              │
│  ⊘  7  Ready for Committee      │
│  │                              │
│  ⊘  8  Decision                 │
│  │                              │
│  ⊘  9  Closing                  │
│  │                              │
│  ⊘  10 Closed                   │
│                                 │
│  ─── Off-path ───                │
│  ⊘  11 Workout                  │  ← branch terminal, separated visually
└─────────────────────────────────┘
```

Width: `260px` desktop, collapses to top horizontal strip below `lg` breakpoint.

**Stage status derivation** (computed inside rail, not from API):

```typescript
type StageStatus =
  | "complete"   // index < currentStageIndex
  | "current"    // index === currentStageIndex
  | "reachable"  // index === currentStageIndex + 1 AND no blockers
  | "locked"     // index > currentStageIndex AND blockers exist for current
  | "skipped";   // workout branch — only "workout" gets this when not on workout path

function deriveStageStatus(
  stage: LifecycleStage,
  state: LifecycleState
): StageStatus {
  const stages = LIFECYCLE_STAGES.map(s => s.code).filter(s => s !== "workout");
  const currentIdx = stages.indexOf(state.stage);
  const thisIdx = stages.indexOf(stage);

  if (stage === "workout") {
    return state.stage === "workout" ? "current" : "skipped";
  }

  if (thisIdx < currentIdx) return "complete";
  if (thisIdx === currentIdx) return "current";
  if (thisIdx === currentIdx + 1 && state.blockers.length === 0) return "reachable";
  return "locked";
}
```

**Action surface — current stage only:**

The current stage row inline-renders one button derived from `getNextAction(state, dealId)`. No other stage shows an action button. If `nextAction.intent === "navigate"`, button is a `<Link href={nextAction.href}>`. If `intent === "advance"`, button POSTs to `/api/deals/[dealId]/lifecycle/advance`. If `intent === "runnable"`, button POSTs to the relevant lifecycle action endpoint. If `intent === "blocked"`, button is replaced with a blocker chip showing `blockers[0].message` truncated to 60 chars + "View blockers" link.

**Blocker surface — locked stages only:**

A locked stage row shows a one-line blocker explanation, derived as: take the *first* blocker from `state.blockers` whose code maps to this specific stage's prerequisites. The mapping is defined in a new helper:

```typescript
// src/buddy/lifecycle/blockerToStage.ts
import type { LifecycleBlockerCode, LifecycleStage } from "./model";

/**
 * Maps a blocker code to the stage it gates.
 * Used by JourneyRail to surface "why this stage is locked" inline.
 * Returns null if blocker doesn't gate a specific stage (e.g. internal_error).
 */
export function blockerGatesStage(
  code: LifecycleBlockerCode
): LifecycleStage | null {
  switch (code) {
    case "checklist_not_seeded":
    case "borrower_not_attached":
    case "loan_request_missing":
    case "loan_request_incomplete":
      return "docs_requested";
    case "gatekeeper_docs_incomplete":
    case "gatekeeper_docs_need_review":
    case "artifacts_processing_stalled":
      return "docs_satisfied";
    case "pricing_assumptions_required":
    case "structural_pricing_missing":
    case "spreads_incomplete":
    case "financial_snapshot_missing":
    case "financial_snapshot_stale":
    case "financial_snapshot_build_failed":
    case "financial_validation_open":
      return "underwrite_ready";
    case "underwrite_not_started":
    case "underwrite_incomplete":
    case "critical_flags_unresolved":
      return "underwrite_in_progress";
    case "committee_packet_missing":
      return "committee_ready";
    case "decision_missing":
    case "policy_exceptions_unresolved":
      return "committee_decisioned";
    case "attestation_missing":
    case "closing_docs_missing":
    case "pricing_quote_missing":
    case "risk_pricing_not_finalized":
      return "closing_in_progress";
    case "intake_health_below_threshold":
    case "intake_confirmation_required":
      return "docs_in_progress";
    // Infrastructure errors — no specific stage
    case "deal_not_found":
    case "schema_mismatch":
    case "internal_error":
    case "data_fetch_failed":
    case "checklist_fetch_failed":
    case "snapshot_fetch_failed":
    case "decision_fetch_failed":
    case "attestation_fetch_failed":
    case "packet_fetch_failed":
    case "advancement_fetch_failed":
    case "readiness_fetch_failed":
      return null;
    default:
      return null;
  }
}
```

If `blockerGatesStage` returns `null` (infrastructure error), surface the blocker as a **rail-level banner above the rail**, not on a specific stage row. This prevents fetch errors from making every locked stage look broken.

**Click behavior:**

- `complete` stage: navigate to that stage's canonical URL (defined below)
- `current` stage: do nothing on row click; button does the action
- `reachable` stage: navigate to that stage's canonical URL
- `locked` stage: do nothing on row click; clicking the inline blocker text expands an accordion showing all blockers gating this stage with their `getBlockerFixAction` links

**Stage → canonical URL map:**

```typescript
// src/components/journey/stageRoutes.ts
import type { LifecycleStage } from "@/buddy/lifecycle/model";

export function stageCanonicalRoute(
  stage: LifecycleStage,
  dealId: string
): string {
  switch (stage) {
    case "intake_created":
    case "docs_requested":
    case "docs_in_progress":
    case "docs_satisfied":
      return `/deals/${dealId}/cockpit`;
    case "underwrite_ready":
    case "underwrite_in_progress":
      return `/deals/${dealId}/underwrite`;
    case "committee_ready":
      return `/deals/${dealId}/committee-studio`;
    case "committee_decisioned":
      return `/deals/${dealId}/decision`;
    case "closing_in_progress":
    case "closed":
      return `/deals/${dealId}/post-close`;
    case "workout":
      return `/deals/${dealId}/special-assets`;
  }
}
```

Verify each of these routes exists before relying on them. If any is missing, fall back to `/deals/${dealId}/cockpit` and log a console warning in dev.

---

### `JourneyMiniRail` — compact 11-dot variant

**File:** `src/components/journey/JourneyMiniRail.tsx`

**Visual contract:**

```
●●●●○○○○○○○   stage 4 of 11 — Documents Complete
```

11 dots in a row, ~8px each, 4px gap. `complete` = solid emerald, `current` = solid blue with subtle pulse, `reachable` = outlined gray, `locked` = filled muted gray. Tooltip on hover shows stage label. Total width: ~150px. Used in deal list rows where a full rail would be overkill but a single-string stage is information-poor.

Mini rail accepts a stage value only — no fetching, no blocker info — so it can render in 80 deal list rows without N+1 queries:

```typescript
type Props = {
  stage: LifecycleStage | null; // null = stage column was null in DB
  className?: string;
};
```

Map `null` → render all 11 dots gray with tooltip "Stage not yet derived." Map a legacy stage value (`collecting`, `underwriting`) to the closest canonical stage via a fallback table inside the component:

```typescript
function legacyStageToCanonical(s: string | null): LifecycleStage | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  // Direct match against canonical stages first
  const direct = LIFECYCLE_STAGES.find(stage => stage.code === lower);
  if (direct) return direct.code;
  // Legacy fallbacks (deals.stage column drift)
  if (lower === "collecting") return "docs_in_progress";
  if (lower === "underwriting") return "underwrite_in_progress";
  if (lower === "intake" || lower === "created") return "intake_created";
  if (lower === "closing") return "closing_in_progress";
  if (lower === "funded" || lower === "closed") return "closed";
  return null;
}
```

---

### `useJourneyState` hook

**File:** `src/hooks/useJourneyState.ts`

```typescript
type UseJourneyStateResult = {
  state: LifecycleState | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

/**
 * Fetches and caches lifecycle state for a deal.
 * - Initial fetch on mount
 * - Background revalidation every 30s while tab is visible
 * - Stops revalidation when tab is hidden (Page Visibility API)
 * - Refetch on window focus
 * - Returns initialState immediately if provided, then revalidates
 */
export function useJourneyState(
  dealId: string,
  options?: { initialState?: LifecycleState; revalidateMs?: number }
): UseJourneyStateResult;
```

Implementation note: do NOT introduce SWR or react-query as a dependency if not already present. Roll a thin custom hook using `useState` + `useEffect` + a module-level cache `Map<dealId, { state, fetchedAt }>`. The cockpit already fetches lifecycle state via `useCockpitDataContext`; the rail inside the cockpit consumes that context directly and does not re-fetch. Only standalone surfaces (deal list, underwrite, committee studio when entered without cockpit context) use this hook.

---

## API additions

**None.** The spec consumes existing endpoints only:

- `GET /api/deals/[dealId]/lifecycle` — read state
- `POST /api/deals/[dealId]/lifecycle/advance` — advance stage
- `POST /api/deals/[dealId]/lifecycle/action` — run server action

If `getNextAction` returns an `intent: "runnable"` action that maps to an endpoint not yet in `/lifecycle/action`, do NOT add a new endpoint in this spec — instead, change the `nextAction` to `intent: "navigate"` pointing to the page where that action's button lives. SPEC-04 will canonicalize `next_action_json` and add server actions as needed.

---

## File-by-file change plan

### New files

| Path | Purpose | Approx LOC |
|---|---|---|
| `src/components/journey/JourneyRail.tsx` | Full vertical rail | 280 |
| `src/components/journey/JourneyMiniRail.tsx` | Compact 11-dot rail | 80 |
| `src/components/journey/StageRow.tsx` | Single row inside rail (extracted for testability) | 120 |
| `src/components/journey/RailHeader.tsx` | Deal name + amount header at top of rail | 60 |
| `src/components/journey/stageRoutes.ts` | Stage → URL map | 30 |
| `src/buddy/lifecycle/blockerToStage.ts` | Blocker → stage mapping | 60 |
| `src/hooks/useJourneyState.ts` | Lifecycle state fetcher hook | 100 |
| `e2e/journey-rail.spec.ts` | Playwright E2E covering 4 stage transitions | 150 |
| `src/components/journey/__tests__/JourneyRail.test.tsx` | Unit tests for rail rendering | 200 |
| `src/components/journey/__tests__/blockerToStage.test.ts` | Unit tests for blocker mapping | 60 |

### Modified files

| Path | Change | Risk |
|---|---|---|
| `src/app/(app)/deals/[dealId]/layout.tsx` | Wrap `DealShell` in a 2-column flex (rail left, content right). Pass `initialState` from server-derived `lifecycleResult`. | Medium — touches Phase 57C-tested route |
| `src/app/(app)/deals/[dealId]/DealShell.tsx` | Reduce `tabs` array from 18 entries to ≤4 (`Documents`, `Financials`, `Risk`, `Relationship`). Header row stays; tab strip shrinks. | Medium — Phase 57C tests reference tab labels |
| `src/app/(app)/deals/page.tsx` | In each row, replace the `Stage` column string with `<JourneyMiniRail stage={...} />`. Mini rail accepts the existing stage column directly — no extra fetches. | Low |
| `src/components/deals/DealCockpitClient.tsx` | Remove `<SecondaryTabsPanel>` mount. Keep imports until SPEC-02 retires the component file. | Low |
| `src/components/deals/__tests__/DealShell.test.tsx` (if exists) | Update tab assertions from 18 → ≤4. | Low |

### Performance note for deal list

Fetching `LifecycleState` for 80 deals on the list page would be 80 sequential queries. The mini rail therefore accepts only a `stage` value (already in the deal list query), and renders 11 dots based on stage position alone — no blocker info, zero new fetches. A future SPEC-04 may add a `POST /api/deals/lifecycle/batch` endpoint if mini rails need richer per-row data; it is explicitly out of scope here.

---

## Tests

### Unit tests — `JourneyRail.test.tsx`

1. Renders all 11 stages plus separated workout row, given a baseline state with `stage: "intake_created"` and no blockers.
2. Marks stages 1 (intake_created) as `current`, 2-10 as `reachable`/`locked` per the derivation rule.
3. With `stage: "underwrite_in_progress"` and zero blockers, marks stages 1-5 as `complete`, 6 as `current`, 7 as `reachable`.
4. With `stage: "docs_in_progress"` and a blocker `code: "gatekeeper_docs_incomplete"`, the `docs_satisfied` row shows the blocker's `message` truncated. The current stage's action button is rendered from `getNextAction`.
5. With a blocker `code: "internal_error"`, no stage row shows a blocker; instead a banner is rendered above the rail.
6. Clicking a `complete` stage row navigates to `stageCanonicalRoute(stage, dealId)` (verify via mocked `useRouter`).
7. Clicking a `locked` stage row does NOT navigate; clicking the blocker text expands an accordion.
8. With `stage: "workout"`, the workout row is `current` and the linear path is dimmed but visible.

### Unit tests — `blockerToStage.test.ts`

1. Every code in `LifecycleBlockerCode` either maps to a `LifecycleStage` or returns `null` — no `undefined`.
2. `gatekeeper_docs_incomplete` → `docs_satisfied`.
3. `committee_packet_missing` → `committee_ready`.
4. `internal_error` → `null`.
5. Exhaustiveness: iterate the union type via a runtime list and assert no missing cases. (Use a typed `const ALL_CODES: LifecycleBlockerCode[]` array — this also serves as compile-time exhaustiveness check.)

### E2E test — `journey-rail.spec.ts`

Against test deal `0279ed32-c25c-4919-b231-5790050331dd` (Samaritus Yacht Management), confirm:

1. **Cockpit page** renders `JourneyRail` to the left of `DealCockpitClient` content.
2. The rail shows `Underwriting` as the `current` stage (deal is `stage: "underwriting"` → maps to `underwrite_in_progress`).
3. Clicking the `Documents Complete` stage row (a `complete` stage) navigates to `/deals/[id]/cockpit` and the rail's current-stage indicator is unchanged.
4. The `Ready for Committee` stage row shows a blocker explanation (per current Samaritus state, this will be `committee_packet_missing` or similar).
5. **Deal list page** renders a `JourneyMiniRail` in each row's stage column, with the Samaritus row showing 6 blue/emerald dots and 5 gray dots (or whatever matches `underwrite_in_progress` position).
6. **`DealShell` tab strip** has exactly 4 tabs visible: `Documents`, `Financials`, `Risk`, `Relationship`. No `Builder`, `Underwrite`, `Committee`, etc.

If the Samaritus state is different at run time (Test Pack Run 2 may have advanced it), assertions 2-5 are parameterized on actual state. Test reads `GET /api/deals/[id]/lifecycle` once at start, derives expected dot counts from response, and asserts against that.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 57C tests reference 18 tab labels in `DealShell` | High | Update tests in same PR. Phase 57C invariant is "DealHealthPanel + BankerVoicePanel only in StoryPanel" — that invariant is unchanged. |
| `LifecycleStage` enum drifts before this lands | Low | PIV step 1 catches this. If drift, reconcile `blockerToStage.ts` and `stageRoutes.ts` exhaustively before merging. |
| Lifecycle endpoint returns `state.stage` that's not in `LIFECYCLE_STAGES` | Low | `JourneyRail` defensively renders fallback "Unknown stage" row + dev-only console error. Does not crash. |
| Mini rail on deal list misrepresents legacy `deals.stage` values | Medium | `legacyStageToCanonical` table covers known drift. Unknown values render as null state. |
| `getNextAction` returns `intent: "runnable"` with a `serverAction` not wired in `/lifecycle/action` | Medium | Verify `/api/deals/[dealId]/lifecycle/action/route.ts` accepts every `ServerActionType` from `nextAction.ts`. If not, change `intent` to `navigate` pointing to the screen where the action lives. |
| Vertical rail breaks mobile layout | Low | Below `lg` breakpoint, rail collapses to top horizontal strip showing only `current` stage + next/prev nav arrows. |
| Cockpit-state-context's `lifecycleState` and rail's fetched state diverge | Medium | Inside cockpit, `JourneyRail` consumes the context directly and does NOT call `useJourneyState`. Source of truth invariant: one fetch per page render. |
| Server-side `lifecycleResult` from `cockpit/page.tsx` has different shape than client fetch | Low | They both return `LifecycleState` from `deriveLifecycleState`. Confirmed by reading both code paths. |

---

## Verification — V-N checklist

After Claude Code reports completion, Matt (or Claude in chat) verifies on `main`:

**V-1.** `src/components/journey/JourneyRail.tsx` exists and exports `JourneyRail`. Read via `github_read_file` — do not trust the AAR.

**V-2.** `src/buddy/lifecycle/blockerToStage.ts` exists and `blockerGatesStage` handles every member of `LifecycleBlockerCode` (verify by counting case statements vs. the union type).

**V-3.** `src/app/(app)/deals/[dealId]/DealShell.tsx` `tabs` array has length ≤ 4. Read the file. Count entries.

**V-4.** `src/app/(app)/deals/[dealId]/layout.tsx` includes `<JourneyRail>` mounted alongside `<DealShell>`.

**V-5.** `src/components/deals/DealCockpitClient.tsx` no longer renders `<SecondaryTabsPanel>`. Grep the file.

**V-6.** `src/app/(app)/deals/page.tsx` renders `<JourneyMiniRail>` in row Stage column.

**V-7.** Run `pnpm test src/components/journey` — all unit tests pass.

**V-8.** Run `pnpm test:e2e -- journey-rail.spec.ts` against staging — all 6 assertions pass against Samaritus.

**V-9.** Pull up `/deals/0279ed32-c25c-4919-b231-5790050331dd/cockpit` in browser. Visual check: rail visible left, current stage highlighted, action button present, no `SecondaryTabsPanel`. Take screenshot, attach to AAR.

**V-10.** `pnpm tsc --noEmit` passes clean. No new TypeScript errors introduced.

**V-11.** Confirm deal list page (`/deals`) renders 11-dot mini rails in each row instead of stage strings. Visual check + screenshot.

**V-12.** Confirm Phase 57C invariants still hold: `DealHealthPanel` and `BankerVoicePanel` only render inside `StoryPanel.tsx`. Run the 10 regression tests from Phase 57C — all pass.

---

## Hand-off commit message

When Claude Code merges to `main`, the commit message must be:

```
feat(journey-rail): SPEC-01 canonical 11-stage navigation

Introduces persistent JourneyRail above all banker deal surfaces, replacing
the 18-tab DealShell strip with one canonical lifecycle navigation.

- New components: JourneyRail (vertical), JourneyMiniRail (deal list),
  StageRow, RailHeader
- New helpers: blockerToStage.ts (blocker code → gating stage),
  stageRoutes.ts (stage → canonical URL)
- New hook: useJourneyState (lifecycle state fetcher with revalidation)
- DealShell tabs reduced from 18 to 4 utility tabs
- SecondaryTabsPanel unmounted from DealCockpitClient (file retained for SPEC-02)
- Deal list stage column replaced with 11-dot JourneyMiniRail
- E2E coverage: e2e/journey-rail.spec.ts against Samaritus test deal
- Unit coverage: JourneyRail render matrix + blockerToStage exhaustiveness

No backend changes. Lifecycle engine (src/buddy/lifecycle/*) unchanged.
Phase 57C invariants preserved.

Spec: specs/banker-journey-fluidity/SPEC-01-journey-rail.md
Refs: phase-underwriting-pipeline-rail.md (sub-stage rail; this wraps it)
```

---

## Addendum for Claude Code

**Critical reminders:**

1. **Read the lifecycle module fresh before writing code.** `src/buddy/lifecycle/model.ts` and `src/buddy/lifecycle/nextAction.ts` are the contract. Any drift between this spec and the actual code is resolved in favor of the code — surface to Matt.

2. **Do not modify the lifecycle engine.** The rail consumes `LifecycleState`. If you find a bug in `deriveLifecycleState` mid-build, file it as a separate finding and continue with the rail using whatever the engine returns.

3. **Phase 57C tests guard `DealHealthPanel` and `BankerVoicePanel` placement.** Those panels still belong only in `StoryPanel.tsx`. This spec does not move them. If your changes break those tests, you've gone outside scope — revert.

4. **No `localStorage` / `sessionStorage` / `cookie` usage in JourneyRail.** State lives in React + the lifecycle endpoint. No client persistence.

5. **Sentence case on every stage label** — defer to `STAGE_LABELS` from `model.ts`. Do not retype labels.

6. **SBA gating:** the existing `DealShell` shows an `SBA Package` tab conditionally on `isSbaDeal`. SPEC-01 retires that tab from the strip; the route remains. The rail does NOT branch on `deal_type` — the lifecycle is the same for SBA and conventional deals. SBA-specific surfaces are accessible from inside the relevant stage's mode views (covered in SPEC-02).

7. **`deal_pipeline_ledger`** events should fire when the rail successfully advances a stage — but `/api/deals/[dealId]/lifecycle/advance` already emits these. Do not add new ledger writes in the rail itself.

8. **AAR requirements:** include the V-N table with each item marked ✓ or ✗. For ✗ items, include the file path + reason. Include screenshots for V-9 and V-11 (desktop viewport, 1280×800 minimum). Include `pnpm tsc --noEmit` output.

9. **If you cannot complete an item**, ship what you have, mark unfinished items in the AAR, and surface a follow-up spec stub. Do not stub the work itself with `// TODO` comments inside production code.

10. **The Samaritus test deal `0279ed32-c25c-4919-b231-5790050331dd`** is the canonical reference. Every visual check happens there. If the deal's state changes during your build, that's expected — Test Pack Run 2 may be running in parallel. Report observed state in AAR.

---

**End of SPEC-01.**
