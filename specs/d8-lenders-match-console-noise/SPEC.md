# Spec D8 — Suppress `/lenders/match` 404 Console Noise

**Date:** 2026-04-23
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 20–30 minutes
**Risk:** Very low. Cosmetic improvement. No pipeline impact.

---

## Summary

Investigation of suspected cockpit bugs (D9 hydration mismatch + D10 `parentNode` null + recurring `/lenders/match` 404 in console) during OMEGA-REPAIR rev 3.3 shipment revealed:

- **D9 and D10 are deploy-cache artifacts, not code bugs.** Verified via MCP-controlled browser reload after the `ccc0d2d` deploy: zero React errors, zero `parentNode` crashes, zero hydration mismatches on a clean cache. The symptoms in Matt's original screenshot were caused by a stale `layout-563e760cc2f16-...js` chunk reference surviving the deploy — classic post-deploy hydration artifact, resolves on hard reload. No code fix needed. Log as "no repro; deploy-cache, not a bug" and move on.

- **D8 is real but cosmetic.** `MatchedLendersPanel.tsx` fetches `/api/deals/[dealId]/lenders/match` unconditionally on every cockpit mount via `useSWR`. The route correctly returns HTTP 404 when no `financial_snapshots` row exists for the deal (pre-loan-request state). The component handles this gracefully (renders "Not available yet"). The only issue: the 404 appears in the browser console network tab as a red entry on every cockpit load for any collecting-stage deal, which is visual noise that makes real errors harder to spot.

This spec fixes D8 only.

## The problem

`src/app/api/deals/[dealId]/lenders/match/route.ts` returns:

```ts
if (!snapshotRow) {
  return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 404 });
}
```

`src/components/deals/MatchedLendersPanel.tsx` calls it unconditionally:

```ts
const { data, error, isLoading } = useSWR(`/api/deals/${dealId}/lenders/match`, fetcher, {
  revalidateOnFocus: false,
  dedupingInterval: 60_000,
});
```

The fetcher already handles 404 correctly:
```ts
if (res.status === 404) return { ok: false, notFound: true };
```

So functional behavior is correct. The 404 is just semantic — "this resource doesn't exist yet because the deal isn't ready" — and the client handles it. But HTTP 404 in a dev console is visually alarming; it looks like a real error among real errors.

Verified against production deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94` (stage = collecting, `financial_snapshots` count = 0, `deal_financial_facts` count = 216). The `/api/deals/.../financial-snapshot` endpoint returns `{ ok: true, snapshot: {...} }` by computing on the fly from `deal_financial_facts` — different data surface, different answer. The `financial_snapshots` table specifically only gets a row after formal underwriting launch.

So "snapshot_not_found" is a precondition-not-met state, not an error. It should be signaled as `200 { ok: false, reason: "snapshot_not_found" }`, not HTTP 404.

## The fix

Change the API route's precondition-not-met path from `status: 404` to `status: 200` with an explicit `reason`. No client change needed — the fetcher already checks `ok` flag on the response body.

## Implementation

### File: `src/app/api/deals/[dealId]/lenders/match/route.ts`

**Change 1:** Replace the 404 early-return with a 200 response body carrying the precondition signal.

```ts
if (!snapshotRow) {
  return NextResponse.json(
    {
      ok: false,
      reason: "snapshot_not_available",
      message: "Financial snapshot must be persisted before lender matching can run.",
      dealId,
    },
    { status: 200 },
  );
}
```

**Rationale for 200:**
- HTTP status codes describe transport success. The request reached the route, auth passed, the server understood it, and it executed. That's a 200.
- The precondition failure is application-level semantics, which belongs in the response body.
- Changing 404 → 200 does not affect existing clients: the fetcher branches on `res.status === 404` to synthesize `{ ok: false, notFound: true }`, and the component also handles `(data && !data.ok)`. The 200-with-`ok:false` path flows through the second branch naturally.
- Error-path HTTP codes (403 deal_not_found, 500 unexpected) remain unchanged — those are genuine failures, not precondition-not-met states.

### File: `src/components/deals/MatchedLendersPanel.tsx`

**Optional simplification (not required for the fix but worth including):** update the fetcher to drop the 404 special case since the server no longer emits it for the precondition-not-met path. Only do this if you audit the tests and confirm no other caller of this endpoint relies on 404 semantics.

```ts
const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  return res.json();
};
```

The component's existing `(error || (data && !data.ok))` branch renders the "Not available yet" state correctly for both the old `{ ok: false, notFound: true }` synthesized shape and the new `{ ok: false, reason: "snapshot_not_available" }` server shape.

If there's any doubt about the fetcher change being safe, leave it alone — the 404 branch just becomes dead code, harmless.

### Tests

Add one test to wherever route tests live (or create one if none exist):

- When no `financial_snapshots` row exists for the deal, route returns status 200 with body `{ ok: false, reason: "snapshot_not_available", message, dealId }`.
- When a `financial_snapshots` row exists and other preconditions are met, route still returns status 200 with `{ ok: true, dealId, matches: {...} }` (unchanged happy path).
- `deal_not_found` still returns 404; `access denied` still returns 403 (unchanged error paths).

If the component has tests, extend them to cover the new response shape. If not, skip — the component's existing early-return branches already cover both shapes.

## Verification

1. **Deploy.** After merge, trigger a production deploy.
2. **Browser check.** Open `/deals/e505cd1c-b03e-4f2d-89ce-95ee69472cf3/cockpit` in a fresh tab. Open DevTools → Network tab. Reload. Filter for `lenders/match`. Confirm: one entry, status `200`, response body starts with `{"ok":false,"reason":"snapshot_not_available"`.
3. **UI check.** "Matched Lenders" panel renders "Not available yet" — same as before. No regression in UX.
4. **Console check.** No `Failed to load resource: the server responded with a status of 404` entries for `/lenders/match`. This is the whole point of the fix.

## Non-goals

- Not investigating D9 (React #418) — verified not reproducible, deploy-cache artifact only.
- Not investigating D10 (`parentNode` null) — same conclusion, downstream symptom of D9.
- Not adding client-side gating of the fetch on deal lifecycle stage — overkill for a cosmetic fix. The server-side status-code change solves the entire problem with one line.
- Not changing any other `status: 404` in the codebase. Only the `snapshot_not_found` branch on this specific route. Other 404 responses represent genuine resource absence and should stay 404.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| External caller depends on HTTP 404 for this route | Very low | Single caller (MatchedLendersPanel); grep confirmed no other references |
| Changing to 200 masks a real error path | Very low | The `{ ok: false, reason }` body is explicit; genuine errors still 500 |
| Fetcher update introduces regression | Low | Optional step; skip if any doubt. Server-side change is sufficient alone |

## Build principle emerging from this

> **HTTP 404 is for resources that don't exist. HTTP 200 with `{ ok: false, reason }` is for preconditions that aren't met yet.** "This request succeeded; the thing you asked about isn't ready yet" is application semantics, not transport failure. Routes that return 404 for precondition-not-met states generate visible console noise that obscures real bugs. Rule: before returning a 404 from an API route, check whether the resource is *genuinely* absent (row never existed, never will for this ID) or *not-yet-ready* (precondition state will resolve as the deal progresses). The latter is a 200 with a body signal.

## Hand-off

Execute directly. Single commit, small diff. Verify via steps 2–4 above.
