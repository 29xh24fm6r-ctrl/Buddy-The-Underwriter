# SPEC: Pipeline Recompute — Auth Policy Decision

**Filed:** 2026-05-07 (during fix-it pass on `fix/main-ci-test-drift-2026-05`)
**Originating commit:** `a6b6e328` — _feat(pipeline): add pipeline observability + one-click recompute_
**Test currently red:** `src/app/api/deals/[dealId]/pipeline-recompute/__tests__/pipelineRecompute.test.ts` — `uses requireRoleApi with super_admin only`
**Blocker for:** green CI on main (1 of 5 originally-red tests stays red until this resolves; the other 4 were stale assertions and were fixed on `fix/main-ci-test-drift-2026-05`)

## Discovery
While triaging the 5 unit-test failures inherited on PR #402's CI run, four resolved as pure test drift (paths, regex contracts, auth-wrapper migration). The fifth — `pipelineRecompute.test.ts` — surfaced a **real policy mismatch**, not test drift.

The test asserts the route uses `requireRoleApi` with `super_admin` only and explicitly forbids `bank_admin` from the allowed-roles list:

```ts
// src/app/api/deals/[dealId]/pipeline-recompute/__tests__/pipelineRecompute.test.ts
assert.ok(source.includes("requireRoleApi"), "must use requireRoleApi for API routes");
assert.ok(source.includes('"super_admin"'),  "must restrict to super_admin");
assert.ok(
  !source.match(/requireRoleApi\(\[.*"bank_admin"/),
  "must NOT allow bank_admin for recompute",
);
```

The actual route (`src/app/api/deals/[dealId]/pipeline-recompute/route.ts:24-34`) uses **only** `ensureDealBankAccess(dealId)` — no role check at all. Its docstring (line 23) however says **"Super-admin only."**

So neither the test nor the docstring matches the implementation. Three sources of truth, three different stories.

## Why this matters
Pipeline recompute is **destructive**:
- Re-enqueues OCR, CLASSIFY, EXTRACT, and SPREADS jobs across the full deal
- Time cost: O(documents × jobs)
- $ cost: re-runs paid LLM extraction, paid OCR
- Data churn: re-extraction can produce different facts, which can disturb already-reconciled deal state and downstream artifacts (snapshots, memos, locked quotes)

Letting any banker self-serve this from the cockpit is plausible but consequential; locking it behind `super_admin` is plausible too. Right now we accidentally have policy #1 in code and policy #2 in the docstring.

## Two scenarios to choose between

**Scenario A — banker self-serve is the intended design.**
- Docstring is wrong; test is wrong.
- Action: delete the "Super-admin only" docstring line, rewrite the test to assert the actual contract (any user with `ensureDealBankAccess` ok can recompute), document the deliberate banker-can-recompute policy in route header.
- Risk: cost / churn from accidental banker re-runs; probably want rate-limiting + a confirm step in the cockpit UI.

**Scenario B — `super_admin`-only is the intended design.**
- Route is missing security; test + docstring are right.
- Action: wrap the handler with `requireRoleApi(req, ["super_admin"])` (or equivalent role-check helper that returns the API-safe `{ok, status}` envelope), keep test asserting it.
- Risk: breaks any UI surface or script that currently invokes the endpoint as a banker. Need to find and update those callers, OR provide a non-recompute alternative for bankers.

## Recommended investigation
1. Grep for `pipeline-recompute` callers (UI, scripts, cron jobs, MCP, smoke tests)
2. For each caller, identify which role(s) need to invoke it in production
3. Decide policy: banker self-serve / super_admin-only / underwriter-and-above / hybrid (broad scope for `SPREADS`, narrow scope for `ALL`)
4. Implement the chosen policy: tighten route + update test + update docstring (or relax docstring + fix test). All three should match.

## Why this isn't bundled into the test-drift fix-it PR
The other 4 failures are pure test-side drift — code evolved, tests didn't follow. This is the opposite: a real policy gap where neither side has been deliberately reconciled. Fixing it requires a product/policy decision, not a code patch. Silently flipping one of the three to match either of the others would either remove a security control that was intended to exist, or block a banker workflow that's quietly relied on today.

## Status
- Filed: 2026-05-07
- Originating commit: `a6b6e328`
- Test currently red: `pipelineRecompute.test.ts` (1 subtest, the others pass)
- Owner: unassigned
- Estimated effort: ~1–2 hours after the policy decision is made; the policy decision itself is the gating step.
