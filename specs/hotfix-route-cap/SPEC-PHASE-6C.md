# SPEC HOTFIX-ROUTE-CAP — Phase 6c (Pages Router orphans, Fork A)

**Date:** 2026-04-28 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** ready · **Type:** P0 hotfix hygiene · **Target:** delete 3 confirmed zero-caller orphans

## Why a Phase 6c

Phase 6 inspector reading: `errorCode: too_many_routes`, `received: 2053`, `max: 2048`. **5 entries over cap.** Project Routes saved 3 entries vs. baseline (validated that path), but fixed-overhead crept across phases (2.064 → 2.118 per-logical-route ratio).

Audit on `src/pages/api/_builder/*` (6 routes) found:

- 3 zero-caller orphans (pulse/call, pulse/diagnose, pulse/health) — safe kills
- 1 ambiguous (deals/latest) — used by `scripts/tests/run-terminal-validation.mjs` ops harness
- 2 load-bearing (verify/google, verify/underwrite) — used by ops verification flow

3 confident kills × 1 entry each (Pages Router routes don't get RSC variant doubling) = ~3 manifest entries. Projected: 2053 - 3 = **2050. Still 2 over cap.**

## Decision (Matt, 2026-04-28)

> "Fork A only. Safe orphans yes, ops-script routes no, structural fix tomorrow."

Phase 6c is **hygiene only.** It does NOT clear the cap. Phase 7 (Proxy Project architecture) is the real fix, scoped for next session.

## Files to delete

```
src/pages/api/_builder/pulse/call.ts
src/pages/api/_builder/pulse/diagnose.ts
src/pages/api/_builder/pulse/health.ts
```

Last commit on each: `d74cc4b3` 2026-01-28 (~91 days ago). All gated by `requireBuilderTokenApi` (custom builder-token header). Pulse MCP tooling — Pulse client lib remains for the audited-still-active app router callers; only these 3 unused Pages-router endpoints are removed.

## Pre-flight verification

Re-run caller grep before deletion. If any new caller is found since the audit (e.g., recent commit added a use), STOP and surface.

```bash
for f in 'pulse/call' 'pulse/diagnose' 'pulse/health'; do
  grep -rn "/api/_builder/$f" src/ scripts/ docs/ specs/ vercel.json .github/ 2>/dev/null \
    | grep -v "src/pages/api/_builder/$f.ts"
done
```

Expected output: empty.

## Verification

```bash
pnpm typecheck
pnpm build
```

Both should pass — these are leaf API routes with no exports consumed elsewhere.

If either fails: STOP. Do not push.

## Commit

Single commit on existing `hotfix/route-cap-demo-removal` branch (after rebase if main has advanced).

Do NOT merge to main. Phase 6c is hygiene that will ride alongside the Phase 7 structural fix.

## Post-deploy (informational only, NOT a merge gate)

After push, watch preview deploy. Read inspector for new `received` count. **This is sizing data for Phase 7** (informational), not a merge decision — we already know 3 entries don't clear the 5-entry gap.

If new `received` shows ≥ 2050: confirms ~3 entries removed as expected. Phase 7 still needed.
If new `received` shows < 2050: Phase 6c overdelivered (e.g., per-route overhead was higher than 1). Surface for analysis.
If new `received` shows ≥ 2053 or > prior: orphan deletion didn't help. Surface for analysis (possible Pages Router routes have hidden cost).

## What NOT to touch

- Anything outside the 3 named files
- PR #353 — stays unmerged (Phase 7 is the real fix)
- Project Routes (still active in production, working correctly per Phase 6 verification)
- Ops scripts referencing `/api/_builder/deals/latest` and `/api/_builder/verify/*` — KEPT per Fork A decision

## AAR requirements

1. Pre-flight grep result (confirm zero callers since audit)
2. Phase 6c commit SHA on `hotfix/route-cap-demo-removal`
3. `pnpm typecheck` + `pnpm build` results
4. Local manifest count: 1965 → final
5. Post-deploy preview `received` count from inspector (informational, for Phase 7 sizing)
6. PR #353 description note added
7. Confirmation: NOT merged
8. Outstanding: Phase 7 (Proxy Project) spec next session

## Out of scope

- Phase 7 Proxy Project architecture — multi-day spec, next session
- Ops-script `_builder/*` routes (deals/latest, verify/google, verify/underwrite) — kept per Fork A
- App Router `_builder/*` private-folder cleanup (those files don't route per Next.js `_` convention; doesn't affect manifest)
- Marketing CTA repoint after production green
- All other deferred items from Phase 6

## Done condition

3 files deleted, build passes, single commit pushed to hotfix branch, AAR with `received` from preview deploy. Production stays red overnight; Phase 7 ships tomorrow.
