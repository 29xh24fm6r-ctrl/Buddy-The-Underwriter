# Phase 68 — Part 2: Committee Wiring, Demo Guard, Acceptance

---

## Step 3 — Replace CommitteeView with Canonical State

**File to replace:** `src/app/(app)/deals/[dealId]/committee/CommitteeView.tsx`

The current file renders `<StitchSurface surfaceKey="credit_committee" />` which
may contain demo content. Replace it entirely with a component that fetches
from the state API.

Do NOT modify `CommitteeDecisionPanel.tsx` — it is the only write action and is correct.
Do NOT modify `committee/page.tsx` — the lifecycle guard and DB fetch there are correct.

```typescript
"use client";

import { useEffect, useState } from "react";
import { OmegaAdvisoryBadge } from "@/components/deals/shared/OmegaAdvisoryBadge";
import { CanonicalStateBanner } from "@/components/deals/shared/CanonicalStateBanner";
import CommitteeDecisionPanel from "./CommitteeDecisionPanel";
import type { BuddyCanonicalState } from "@/core/state/types";
import type { OmegaAdvisoryState } from "@/core/omega/types";
import type { SystemAction } from "@/core/state/types";

type StateResponse = {
  ok: boolean;
  state: BuddyCanonicalState;
  omega: OmegaAdvisoryState;
  explanation: { summary: string; blockerText?: string };
  primaryAction: SystemAction;
};

type SnapshotInfo = { createdAt: string };

export function CommitteeView({
  dealId,
  borrowerName,
  borrowerEntityType,
  snapshot,
}: {
  dealId: string;
  borrowerName: string;
  borrowerEntityType: string;
  snapshot?: SnapshotInfo | null;
}) {
  const [data, setData] = useState<StateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/deals/${dealId}/state`)
      .then((r) => r.json())
      .then((d: StateResponse) => {
        if (!d.ok) throw new Error("State fetch failed");
        setData(d);
      })
      .catch((e) => setError(e?.message ?? "Failed to load deal state"))
      .finally(() => setLoading(false));
  }, [dealId]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header — borrowerName comes from server, not from state fetch */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Committee Review</h1>
            <p className="text-sm text-gray-500">
              {borrowerName} · {borrowerEntityType}
            </p>
          </div>
          {snapshot && (
            <div className="rounded-lg bg-blue-50 px-4 py-2">
              <div className="text-xs text-blue-600">Snapshot</div>
              <div className="text-sm font-medium text-blue-900">
                {new Date(snapshot.createdAt).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6 p-6">
        {loading && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            Loading deal state…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Required action banner */}
            <CanonicalStateBanner action={data.primaryAction} variant="card" />

            {/* Deal summary grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                label="Stage"
                value={data.state.lifecycle.replace(/_/g, " ")}
              />
              <SummaryCard
                label="Committee"
                value={
                  data.state.committeeState.complete
                    ? data.state.committeeState.outcome.replace(/_/g, " ")
                    : `${data.state.committeeState.voteCount} / ${data.state.committeeState.quorum} votes`
                }
              />
              <SummaryCard
                label="Exceptions"
                value={
                  data.state.exceptionState.openCount === 0
                    ? "None open"
                    : `${data.state.exceptionState.openCount} open` +
                      (data.state.exceptionState.criticalCount > 0
                        ? ` · ${data.state.exceptionState.criticalCount} critical`
                        : "")
                }
                highlight={data.state.exceptionState.criticalCount > 0}
              />
              <SummaryCard
                label="Checklist"
                value={
                  data.state.checklistReadiness.ready
                    ? "Ready"
                    : `${data.state.checklistReadiness.satisfiedItems} / ${data.state.checklistReadiness.totalItems}`
                }
              />
            </div>

            {/* Explanation + Omega advisory — side by side */}
            <div className="grid gap-4 lg:grid-cols-2">
              {data.explanation?.summary && (
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Buddy
                  </div>
                  <p className="text-sm text-gray-700">{data.explanation.summary}</p>
                  {data.explanation.blockerText && (
                    <p className="mt-2 text-xs text-amber-700">{data.explanation.blockerText}</p>
                  )}
                </div>
              )}
              {data.omega && (
                <div className="rounded-xl border border-gray-200 bg-white p-5">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Omega advisory
                  </div>
                  <OmegaAdvisoryBadge omega={data.omega} />
                </div>
              )}
            </div>

            {/* Blockers */}
            {data.state.blockers.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 text-sm font-semibold text-amber-900">Active blockers</div>
                <ul className="space-y-1">
                  {data.state.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-amber-800">· {String(b)}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Decision panel — this is the only write action, unchanged */}
        <CommitteeDecisionPanel dealId={dealId} />
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={`mt-1 text-sm font-semibold capitalize ${
          highlight ? "text-red-800" : "text-gray-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
```

---

## Step 4 — Add Omega Badge to Underwrite Surface

Find `AnalystWorkbench`. It lives under:
`src/app/(app)/deals/[dealId]/underwrite/`

1. If the workbench already fetches `/api/deals/${dealId}/state`, extract `omega`
   from that response — do not add a second fetch.
2. If it does not already fetch state, add a single `useEffect` fetch of
   `/api/deals/${dealId}/state` to get `omega` only. Store it in local state.
3. Add `<OmegaAdvisoryBadge omega={omegaState} compact />` in the workbench
   header panel, next to existing status indicators.
4. Import from `@/components/deals/shared/OmegaAdvisoryBadge`.
5. Handle the loading state: render nothing (null) until `omega` is available.
6. Do NOT touch spread logic, snapshot logic, extraction calls, or action engine.

---

## Step 5 — Demo Data CI Guard

**New file:** `scripts/guard-demo-data.sh`

```bash
#!/usr/bin/env bash
set -e

DEMO_STRINGS=(
  "Highland Capital"
  "Project Atlas"
  "Titan Equities"
)

FOUND=0
for pattern in "${DEMO_STRINGS[@]}"; do
  matches=$(grep -rl "$pattern" src/ --include="*.tsx" --include="*.ts" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "FAIL: Demo string '$pattern' found in:"
    echo "$matches"
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "guard:demo-data FAILED — remove demo data before deploying."
  exit 1
fi

echo "guard:demo-data PASSED"
```

Make it executable: `chmod +x scripts/guard-demo-data.sh`

**Update `package.json` scripts block:**

Find the existing `guard:all` line. Replace it with:
```json
"guard:demo-data": "bash scripts/guard-demo-data.sh",
"guard:all": "npm run guard:schema && npm run guard:render && npm run guard:phase66 && npm run guard:demo-data"
```

If `guard:schema`, `guard:render`, or `guard:phase66` do not exist in the current
`package.json`, only add `guard:demo-data` to whatever guards currently exist in
`guard:all` — do not reference scripts that don't exist.

---

## Acceptance Criteria

All items must be verified before returning the AAR:

**Components**
- [ ] `src/components/deals/shared/OmegaAdvisoryBadge.tsx` exists
- [ ] `src/components/deals/shared/CanonicalStateBanner.tsx` exists
- [ ] OmegaAdvisoryBadge renders stale state gracefully (no score, message shown)
- [ ] OmegaAdvisoryBadge colors: green ≥ 80, amber 60–79, red < 60
- [ ] CanonicalStateBanner renders amber for blocked, green for complete, blue for advance

**Committee surface**
- [ ] `CommitteeView.tsx` no longer renders StitchSurface
- [ ] Committee page shows: stage, committee vote status, exception count, checklist status
- [ ] Committee page shows Omega advisory badge
- [ ] Committee page shows Buddy explanation summary
- [ ] No hardcoded borrower/deal/bank names in CommitteeView.tsx
- [ ] `CommitteeDecisionPanel.tsx` is unchanged

**Underwrite surface**
- [ ] `OmegaAdvisoryBadge` renders in AnalystWorkbench header (compact mode)
- [ ] No second redundant state fetch added if one already exists

**Demo data guard**
- [ ] `scripts/guard-demo-data.sh` exists and is executable
- [ ] `npm run guard:demo-data` exits 0 on clean repo
- [ ] `npm run guard:demo-data` exits 1 if a demo string is found
- [ ] `guard:demo-data` is included in `guard:all`

**Quality**
- [ ] `tsc --noEmit` clean — zero new type errors
- [ ] All existing tests pass
- [ ] OmegaAdvisoryBadge has unit tests

---

## What NOT to change

```
src/app/api/deals/[dealId]/state/route.ts
src/core/state/BuddyCanonicalStateAdapter.ts
src/core/state/types.ts
src/core/omega/OmegaAdvisoryAdapter.ts
src/core/omega/types.ts
src/core/omega/formatOmegaAdvisory.ts
src/core/actions/deriveNextActions.ts
src/core/explanation/deriveBuddyExplanation.ts
committee/page.tsx
committee/CommitteeDecisionPanel.tsx
Any existing guard scripts (only add to guard:all, never remove)
AnalystWorkbench spread/snapshot/extraction logic
```

---

## AAR Format

Return a single AAR with:
1. Files created (path + line count)
2. Files modified (path + what changed)
3. Demo data grep result (strings found / not found, files affected)
4. `tsc --noEmit` result
5. Test results (pass count)
6. Deviations from spec with rationale (none = "spec followed exactly")
