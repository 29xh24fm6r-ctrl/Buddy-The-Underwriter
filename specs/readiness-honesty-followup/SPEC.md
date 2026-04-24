# Spec READINESS-HONESTY-FOLLOWUP — Treat Error Spreads as Warning, Not Complete

**Date:** 2026-04-24
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 30–45 minutes
**Risk:** Very low. ~15-line diff in one file + test updates. No DB work.

---

## Background

STUCK-SPREADS Batch 3 (commit `a6d92a8b`, shipped 2026-04-23) updated `computeReadinessAndBlockers` to count `error` status as terminal and therefore "complete" when all spreads are terminal. Verification on 2026-04-24 showed this produces a misleading UX:

- Test deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94` has 6 spreads: 4 `ready`, 2 `error` (GLOBAL_CASH_FLOW + PERSONAL_FINANCIAL_STATEMENT, both `error_code: TIMEOUT`).
- Cockpit-state API reports `spreads: complete`.
- That's "terminal" but not "successful" — a banker about to advance the deal sees green when the underlying spreads have actually failed.

The original spec said: "Every spread row that exists for the deal has `status IN ('ready', 'error', 'failed')` (terminal)" → counts as complete. That language was wrong. **Terminal-failed should not count as complete.** This spec corrects that.

## Build principle being captured

> **(11) "Terminal" state is not the same as "successful" state.** When defining readiness gates, distinguish between `terminal_ok` (`ready`) and `terminal_failed` (`error`/`failed`). A category should be "complete" only when all rows are `terminal_ok`. A row in `error` should at minimum count as "warning" because it represents work that couldn't finish, not work that finished successfully. (READINESS-HONESTY-FOLLOWUP, 2026-04-24)

## Production state today (PIV)

```sql
-- Confirm distribution of error codes before changing logic
SELECT error_code, COUNT(*) as n, COUNT(DISTINCT deal_id) as deals_affected
FROM deal_spreads
WHERE status = 'error' AND error_code IS NOT NULL
GROUP BY error_code
ORDER BY n DESC;
```

Snapshot taken 2026-04-24 (run again and confirm before proceeding):
- `TIMEOUT` — 6 rows across 3 deals (mostly observer-healed orphans from STUCK-SPREADS pre-fix)
- `MISSING_UPSTREAM_FACTS` — 2 rows across 2 deals (genuine prereq-not-met)

Both error codes represent "spread didn't successfully render." Neither represents "skipped because not applicable." There is no current `not_applicable` pathway in the spread system, so we don't need to handle that case yet.

If PIV reveals NEW error codes that represent legitimate skips (e.g. `NOT_APPLICABLE_FOR_DEAL_TYPE`), STOP and surface — the spec needs to include allow-list logic.

## The fix

### File: `src/lib/documentTruth/computeReadinessAndBlockers.ts`

**Current logic (lines roughly 110–135):**

```ts
// Spread readiness — honest about non-terminal (stuck) rows.
// "Complete" requires all existing spreads to be in a terminal state
// (ready or error). Any stuck row downgrades the category to "warning"
// and emits a blocker listing the stuck spread types.
const s = input.spreadStats;
let spreadsStatus: ReadinessCategoryStatus;
if (s.total === 0) {
  spreadsStatus = "warning";
} else if (s.stuck > 0) {
  spreadsStatus = "warning";
} else if (s.terminal === s.total) {
  spreadsStatus = "complete";
} else {
  spreadsStatus = "warning";
}

if (s.stuck > 0) {
  const typeList = s.stuckTypes.join(", ");
  blockers.push({
    code: "spreads_stuck",
    severity: "warning",
    title: `Spreads stuck: ${s.stuck} of ${s.total}`,
    details: [`Stuck spread types: ${typeList || "unknown"}`],
    actionLabel: "",
  });
}
```

**New logic:**

```ts
// Spread readiness — distinguishes succeeded from terminal-failed.
// "Complete" requires all spreads in `ready` status (succeeded).
// Any `error`/`failed` row (terminal but not successful) downgrades to warning
// and emits a blocker. Any `queued`/`generating` stuck row downgrades to warning.
//
// See build principle #11 (READINESS-HONESTY-FOLLOWUP): terminal != successful.
const s = input.spreadStats;
let spreadsStatus: ReadinessCategoryStatus;
if (s.total === 0) {
  spreadsStatus = "warning";
} else if (s.stuck > 0 || s.errored > 0) {
  spreadsStatus = "warning";
} else if (s.ready === s.total) {
  spreadsStatus = "complete";
} else {
  // Non-terminal rows exist but aren't yet "stuck" (under the staleness
  // threshold). Still warning — a spread that's generating is not complete.
  spreadsStatus = "warning";
}

if (s.stuck > 0) {
  const typeList = s.stuckTypes.join(", ");
  blockers.push({
    code: "spreads_stuck",
    severity: "warning",
    title: `Spreads stuck: ${s.stuck} of ${s.total}`,
    details: [`Stuck spread types: ${typeList || "unknown"}`],
    actionLabel: "",
  });
}

if (s.errored > 0) {
  const typeList = s.erroredTypes.join(", ");
  blockers.push({
    code: "spreads_errored",
    severity: "warning",
    title: `Spreads failed to render: ${s.errored} of ${s.total}`,
    details: [
      `Errored spread types: ${typeList || "unknown"}`,
      "These spreads reached a terminal state without succeeding. Re-running orchestration may resolve them.",
    ],
    actionLabel: "",
  });
}
```

### File: `src/lib/documentTruth/computeReadinessAndBlockers.ts` (SpreadStats type)

Update the type to include the new fields:

```ts
export type SpreadStats = {
  total: number;
  ready: number;        // NEW: count in status === 'ready' (succeeded)
  errored: number;      // NEW: count in status === 'error' OR 'failed'
  erroredTypes: string[]; // NEW: spread_type values for errored rows
  terminal: number;     // KEEP for backward compat; ready + errored
  stuck: number;
  stuckTypes: string[];
};
```

`terminal` is kept as a derived field (`ready + errored`) for backward compatibility with any consumer reading it. New logic uses `ready` and `errored` separately.

### File: `src/app/api/deals/[dealId]/cockpit-state/route.ts`

Update the spread-stats computation block (currently lines 105–138 approximately) to populate the new fields:

```ts
// STUCK-SPREADS Batch 3 + READINESS-HONESTY-FOLLOWUP: fetch all spreads and
// distinguish ready (succeeded) from error/failed (terminal but failed) and
// queued/generating (in flight or stuck).
const { data: spreadRows } = await sb
  .from("deal_spreads")
  .select("spread_type, status, started_at, updated_at")
  .eq("deal_id", dealId);

const SPREAD_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 min; matches janitor
const nowMs = Date.now();
const spreadRowsArr = (spreadRows ?? []) as Array<{
  spread_type: string | null;
  status: string | null;
  started_at: string | null;
  updated_at: string | null;
}>;
let spreadReady = 0;
let spreadErrored = 0;
let spreadStuck = 0;
const spreadErroredTypes: string[] = [];
const spreadStuckTypes: string[] = [];
for (const row of spreadRowsArr) {
  const st = row.status ?? "";
  if (st === "ready") {
    spreadReady += 1;
    continue;
  }
  if (st === "error" || st === "failed") {
    spreadErrored += 1;
    if (row.spread_type) spreadErroredTypes.push(row.spread_type);
    continue;
  }
  // Only 'queued' or 'generating' reach here. Determine if stuck.
  const updatedMs = row.updated_at ? Date.parse(row.updated_at) : NaN;
  const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : 0;
  if (ageMs > SPREAD_STUCK_THRESHOLD_MS) {
    spreadStuck += 1;
    if (row.spread_type) spreadStuckTypes.push(row.spread_type);
  }
}
const spreadStats = {
  total: spreadRowsArr.length,
  ready: spreadReady,
  errored: spreadErrored,
  erroredTypes: spreadErroredTypes,
  terminal: spreadReady + spreadErrored,  // back-compat
  stuck: spreadStuck,
  stuckTypes: spreadStuckTypes,
};
```

## Tests

Update existing Batch 3 unit tests in whatever test file Claude Code created (likely `src/lib/documentTruth/__tests__/computeReadinessAndBlockers.test.ts`).

Add cases:

- **All ready, no error, no stuck** → `complete`, no blockers from spread category
- **All ready except one errored** → `warning`, `spreads_errored` blocker present, names the errored type
- **All ready except one stuck** → `warning`, `spreads_stuck` blocker present (existing behavior, regression test)
- **Mix: 4 ready + 1 errored + 1 stuck** → `warning`, BOTH `spreads_errored` AND `spreads_stuck` blockers present
- **All errored** → `warning`, errored blocker present, all types listed
- **total === 0** → `warning`, no blockers from spread category (existing behavior, regression test)

Verify any callers of `SpreadStats.terminal` still work (search for `.terminal` references in spreads context).

## Verification (V-1)

After deploy, hit cockpit-state for the test deal:

```bash
curl -s 'https://app.buddytheunderwriter.com/api/deals/e505cd1c-86b4-4d73-88e3-bc71ef342d94/cockpit-state' \
  -H 'cookie: <auth>' | jq '{
    spreadsCategory: (.readiness.categories[] | select(.code == "spreads")),
    spreadBlockers: [.blockers[] | select(.code | startswith("spreads_"))]
  }'
```

Expected response shape:

```json
{
  "spreadsCategory": { "code": "spreads", "status": "warning" },
  "spreadBlockers": [
    {
      "code": "spreads_errored",
      "severity": "warning",
      "title": "Spreads failed to render: 2 of 6",
      "details": [
        "Errored spread types: GLOBAL_CASH_FLOW, PERSONAL_FINANCIAL_STATEMENT",
        "These spreads reached a terminal state without succeeding. Re-running orchestration may resolve them."
      ],
      "actionLabel": ""
    }
  ]
}
```

Then load the cockpit in the browser and confirm:
- Readiness panel shows "Spreads: Warning" (or whatever icon/label maps to warning)
- A blocker line is visible naming the errored spread types

## Non-goals

- Do NOT differentiate by `error_code` (TIMEOUT vs MISSING_UPSTREAM_FACTS). Both are warning. Refinement is a future spec if useful.
- Do NOT change any gating logic that consumes readiness — only the cockpit display surface. If `readiness.percent` is consumed elsewhere as a deal-progression gate, the change here is conservative (some `complete` becomes `warning`, never the reverse), so no progression breaks. Confirm via grep before commit.
- Do NOT add a "rerun spreads" action button in this spec. The blocker advises "Re-running orchestration may resolve them" but the actual rerun UX is a separate piece. Future spec.
- Do NOT add a `not_applicable` status. No current pathway produces it. Future spec when needed.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Some downstream gate reads `categories[spreads].status === "complete"` and now stops advancing | Low | Grep before commit. The change is conservative (some complete → warning), so any gate that fires on "complete" simply waits longer; nothing breaks |
| `SpreadStats.terminal` is read by code I haven't found | Low | Kept as back-compat derived field (`ready + errored`); existing readers see same value |
| Test deal state changes between PIV and verification | Very low | Both states (`ready` + `error`) for the test deal are stable; observer-healed at 21:20 yesterday |
| Future `error_code: NOT_APPLICABLE_*` would create false warnings | Out of scope today | Documented in non-goals; whenever introduced, this function gets an allow-list of "skipped" codes |

## Hand-off

Single-commit. Title:

```
fix(readiness): error spreads count as warning, not complete (READINESS-HONESTY-FOLLOWUP)

STUCK-SPREADS Batch 3 made readiness honest about stuck spreads but still
reported "complete" when spreads reached error status. Errored spreads are
terminal but not successful — banker would see green and advance a deal
where GCF/PFS failed to render.

- Distinguish `ready` (succeeded) from `error`/`failed` (terminal-failed) in
  SpreadStats; emit a separate `spreads_errored` blocker.
- "Complete" now requires all spreads to be `ready`, not merely terminal.
- Tests updated; back-compat `terminal` field preserved.

Refs: build principle #11 (terminal != successful).
Closes: cockpit verification gap surfaced 2026-04-24 morning verification.
```

Then deploy and run V-1.
