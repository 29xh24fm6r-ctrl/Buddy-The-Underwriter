# Phase 69 — Reconciliation Wiring
## Auto-trigger, Committee Gate, and Status Surface

**Date:** April 2026
**Status:** Spec — ready for implementation

---

## Context

`reconcileDeal()` exists in `src/lib/reconciliation/dealReconciliator.ts` and is
complete — 6 cross-document checks, writes to `deal_reconciliation_results`.
It has never been called. The table is empty for all deals including `ffcc9733`.

Three things need to happen:
1. Reconciliation must be triggered automatically
2. Committee approve must be gated on reconciliation result
3. CommitteeView must show recon status

---

## What NOT to touch

```
src/lib/reconciliation/dealReconciliator.ts     ← do not modify
src/lib/reconciliation/types.ts                 ← do not modify
src/lib/reconciliation/*.ts (all checks)        ← do not modify
src/buddy/lifecycle/deriveLifecycleState.ts     ← do not modify
src/core/state/BuddyCanonicalStateAdapter.ts    ← do not modify
src/app/(app)/deals/[dealId]/committee/CommitteeDecisionPanel.tsx ← do not modify
src/app/(app)/deals/[dealId]/committee/page.tsx ← do not modify
```

---

## Step 0 — Pre-work: verify current state

Run this SQL and log result in AAR:

```sql
SELECT deal_id, overall_status, checks_run, reconciled_at
FROM deal_reconciliation_results
WHERE deal_id = 'ffcc9733-f866-47fc-83f9-7c08403cea71';
```

Expected: 0 rows (confirms the gap). If a row exists, note it and adjust
Step 4 accordingly.

---

## Step 1 — Create `/api/deals/[dealId]/reconcile` route

**File:** `src/app/api/deals/[dealId]/reconcile/route.ts`

This is the on-demand trigger and the auto-trigger entry point.

```typescript
import "server-only";
import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileDeal } from "@/lib/reconciliation/dealReconciliator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const summary = await reconcileDeal(dealId);

  return NextResponse.json({
    ok: true,
    reconStatus: summary.overallStatus,
    checksRun: summary.checksRun,
    checksPassed: summary.checksPassed,
    checksFailed: summary.checksFailed,
    hardFailures: summary.hardFailures,
    softFlags: summary.softFlags,
    reconciledAt: summary.reconciledAt,
  });
}

// GET — returns current reconciliation result without re-running
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deal_reconciliation_results")
    .select(
      "overall_status, checks_run, checks_passed, checks_failed, hard_failures, soft_flags, reconciled_at",
    )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ ok: true, reconStatus: null, reconciledAt: null });
  }

  return NextResponse.json({
    ok: true,
    reconStatus: data.overall_status,
    checksRun: data.checks_run,
    checksPassed: data.checks_passed,
    checksFailed: data.checks_failed,
    hardFailures: data.hard_failures,
    softFlags: data.soft_flags,
    reconciledAt: data.reconciled_at,
  });
}
```

---

## Step 2 — Wire auto-trigger into underwrite state route

The underwriting state route exists at:
`src/app/api/deals/[dealId]/underwrite/` (find the route.ts)

If no underwrite state route exists, check:
`src/app/api/deals/[dealId]/launch-underwriting/route.ts`

In whichever route handles underwriting activation or state, add a fire-and-
forget reconciliation trigger if no recon results exist for the deal yet.

Pattern to add (fire-and-forget, never awaited, never throws):

```typescript
// Fire-and-forget reconciliation trigger
// Only runs if no results exist yet — idempotent
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileDeal } from "@/lib/reconciliation/dealReconciliator";

const sb = supabaseAdmin();
const { data: existingRecon } = await sb
  .from("deal_reconciliation_results")
  .select("deal_id")
  .eq("deal_id", dealId)
  .maybeSingle();

if (!existingRecon) {
  reconcileDeal(dealId).catch((err) =>
    console.error("[underwrite] reconciliation trigger failed", { dealId, err })
  );
}
```

If neither underwrite route is found, skip this step and note it in the AAR.
The on-demand POST route from Step 1 is sufficient to unblock ffcc9733.

---

## Step 3 — Gate committee approve action

**File to modify:** `src/app/api/deals/[dealId]/actions/route.ts`

Find the `case "approve":` block. Replace it:

```typescript
case "approve": {
  // Reconciliation gate — CONFLICTS block approve
  const { data: reconRow } = await sb
    .from("deal_reconciliation_results")
    .select("overall_status")
    .eq("deal_id", dealId)
    .maybeSingle();

  // NULL = never run → treat as not-ready
  if (!reconRow) {
    return NextResponse.json(
      {
        ok: false,
        error: "Reconciliation has not been run for this deal. Run reconciliation before approving.",
        code: "RECONCILIATION_NOT_RUN",
      },
      { status: 422 },
    );
  }

  // CONFLICTS = hard cross-document failures → block approve
  if (reconRow.overall_status === "CONFLICTS") {
    return NextResponse.json(
      {
        ok: false,
        error: "This deal has unresolved cross-document conflicts. Resolve conflicts before approving.",
        code: "RECONCILIATION_CONFLICTS",
      },
      { status: 422 },
    );
  }

  // FLAGS = soft warnings → allow approve (banker judgment call)
  // CLEAN = pass → allow approve
  await sb.from("deals").update({ stage: "approved" }).eq("id", dealId);
  break;
}
```

Key rules:
- NULL (not run) → block with `RECONCILIATION_NOT_RUN`
- CONFLICTS (hard failures) → block with `RECONCILIATION_CONFLICTS`
- FLAGS (soft warnings) → allow (banker judgment)
- CLEAN → allow

---

## Step 4 — Add ReconStatusCard to CommitteeView

**File to modify:** `src/app/(app)/deals/[dealId]/committee/CommitteeView.tsx`

Add a reconciliation status fetch and a status card. The existing component
already fetches `/api/deals/${dealId}/state` — add a second parallel fetch
for `/api/deals/${dealId}/reconcile` (GET).

Add this to the existing `useEffect` or as a second `useEffect`:

```typescript
// Add to state at top of component
const [recon, setRecon] = useState<{
  reconStatus: "CLEAN" | "FLAGS" | "CONFLICTS" | null;
  checksRun?: number;
  checksFailed?: number;
  hardFailures?: Array<{ checkName: string; message: string }>;
  softFlags?: Array<{ checkName: string; message: string }>;
  reconciledAt?: string | null;
} | null>(null);
const [reconLoading, setReconLoading] = useState(true);

// Add this useEffect (parallel to the state fetch):
useEffect(() => {
  fetch(`/api/deals/${dealId}/reconcile`)
    .then((r) => r.json())
    .then((d) => setRecon(d))
    .catch(() => setRecon(null))
    .finally(() => setReconLoading(false));
}, [dealId]);
```

Add this card in the grid section (after the 4 existing SummaryCards):

```typescript
{/* Reconciliation status card */}
<div
  className={`rounded-xl border p-4 ${
    recon?.reconStatus === "CONFLICTS"
      ? "border-red-200 bg-red-50"
      : recon?.reconStatus === "FLAGS"
      ? "border-amber-200 bg-amber-50"
      : recon?.reconStatus === "CLEAN"
      ? "border-green-200 bg-green-50"
      : "border-gray-200 bg-white"
  }`}
>
  <div className="text-xs text-gray-500">Reconciliation</div>
  <div
    className={`mt-1 text-sm font-semibold ${
      recon?.reconStatus === "CONFLICTS"
        ? "text-red-800"
        : recon?.reconStatus === "FLAGS"
        ? "text-amber-800"
        : recon?.reconStatus === "CLEAN"
        ? "text-green-800"
        : "text-gray-400"
    }`}
  >
    {reconLoading
      ? "Loading…"
      : recon?.reconStatus === null || !recon?.reconStatus
      ? "Not run"
      : recon.reconStatus}
  </div>
  {recon?.reconStatus === null && !reconLoading && (
    <button
      onClick={() => {
        setReconLoading(true);
        fetch(`/api/deals/${dealId}/reconcile`, { method: "POST" })
          .then((r) => r.json())
          .then((d) => setRecon(d))
          .catch(() => {})
          .finally(() => setReconLoading(false));
      }}
      className="mt-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
    >
      Run now
    </button>
  )}
  {recon?.reconciledAt && (
    <div className="mt-1 text-xs text-gray-400">
      {new Date(recon.reconciledAt).toLocaleString()}
    </div>
  )}
</div>
```

If recon has hard failures, also surface them in the blockers section:

```typescript
{/* Hard reconciliation failures — shown alongside lifecycle blockers */}
{recon?.hardFailures && recon.hardFailures.length > 0 && (
  <div className="rounded-xl border border-red-200 bg-red-50 p-4">
    <div className="mb-2 text-sm font-semibold text-red-900">
      Cross-document conflicts ({recon.hardFailures.length})
    </div>
    <ul className="space-y-1">
      {recon.hardFailures.map((f, i) => (
        <li key={i} className="text-xs text-red-800">
          · {f.checkName}: {f.message}
        </li>
      ))}
    </ul>
  </div>
)}
```

---

## Step 5 — Update CommitteeDecisionPanel error handling

**File to modify:** `src/app/(app)/deals/[dealId]/committee/CommitteeDecisionPanel.tsx`

The panel currently does `alert(\`Error: ${e?.message ?? e}\`)`.
Update the approve error handling to surface reconciliation-specific errors
more clearly:

```typescript
// Replace the catch block in handleDecision for approve:
} catch (e: any) {
  // Parse structured error from approve gate
  let message = e?.message ?? String(e);
  try {
    const parsed = JSON.parse(e?.message ?? "");
    if (parsed?.code === "RECONCILIATION_NOT_RUN") {
      message = "Reconciliation has not been run. Use the 'Run now' button in the reconciliation card before approving.";
    } else if (parsed?.code === "RECONCILIATION_CONFLICTS") {
      message = "This deal has cross-document conflicts that must be resolved before it can be approved.";
    }
  } catch {}
  alert(`Cannot approve: ${message}`);
}
```

Note: the fetch in `handleDecision` returns `res.json()` — if `!res.ok`, throw
with the response body. Ensure the catch reads the response body before
throwing:

```typescript
if (!res.ok) {
  const body = await res.json().catch(() => ({}));
  throw new Error(JSON.stringify(body));
}
```

---

## Acceptance Criteria

- [ ] `GET /api/deals/[dealId]/reconcile` returns `{ ok, reconStatus: null }` for ffcc9733 (pre-run)
- [ ] `POST /api/deals/[dealId]/reconcile` runs `reconcileDeal()` and returns `{ ok, reconStatus, checksRun, ... }`
- [ ] After POST, `GET /api/deals/ffcc9733.../reconcile` returns a non-null `reconStatus`
- [ ] Approve action blocked with 422 `RECONCILIATION_NOT_RUN` when no recon row exists
- [ ] Approve action blocked with 422 `RECONCILIATION_CONFLICTS` when status is CONFLICTS
- [ ] Approve action succeeds when status is FLAGS or CLEAN
- [ ] CommitteeView shows reconciliation status card
- [ ] "Run now" button appears when status is null and triggers POST
- [ ] Hard failures shown as a separate block below the grid
- [ ] CommitteeDecisionPanel surfaces reconciliation-specific error copy
- [ ] `tsc --noEmit` clean
- [ ] All existing tests pass

## AAR format

1. Pre-work SQL result (rows found / not found)
2. Files created (path + purpose)
3. Files modified (path + what changed)
4. Manual smoke test: POST to reconcile on ffcc9733, paste the response
5. `tsc --noEmit` result
6. Test pass count
7. Deviations from spec with rationale
