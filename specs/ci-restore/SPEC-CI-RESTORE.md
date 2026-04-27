# SPEC CI-RESTORE — Pre-existing CI debt cleanup

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** in progress · **Total est:** 1.5–2 days, 5–6 PRs

## Background

Pre-existing failures on `origin/main` cascade-skip `Schema drift detection`
(SD-C) on every CI run. Discovered while attempting SD-C's first
post-merge drift report (commit `e49af672`). Each blocker gets its own
scoped PR; no bundling, no broad lint config softening, no `if: always()`
workflow patches.

SD-A is unblocked separately via Track 1 (Supabase MCP one-shot drift run
committed to repo). This spec tracks the parallel CI-greenness work.

## Blockers

| # | Blocker | Status | PR | Effort | Notes |
|---|---|---|---|---|---|
| 1 | Typecheck — missing `dotenv` direct dep | ✅ done | #350 | 5 min | Promoted from transitive |
| 2 | Lint — `useBuddyVoice.ts` refs-during-render (×2) | ⏳ next | TBD | ~15 min | Move ref assignments into `useEffect` |
| 3 | Lint — `no-explicit-any` (×8 across 3 files) | ⏳ next | TBD | ~30 min | Real types where obvious; targeted disable + comment otherwise |
| 4 | Lint — `DealPricingClient.tsx` hooks-rules (×22) | ⏳ surfaced | TBD | ~45 min | Real runtime bug. F1 outer-gate split recommended; awaiting Matt |
| 5 | Architectural guards | ⏳ unknown | TBD | TBD | Surface findings when we reach this step |
| 6 | Unit tests (4 known failures) | ⏳ unknown | TBD | TBD | `useBuddyVoice`, `redaction.server`, `intakeCockpitHardeningGuard`, `trustLayerGuard` |
| 7 | `Buffer<ArrayBufferLike>` (from prior CI-RESTORE memory) | ⏳ unknown | TBD | TBD | Look up original context |

## Order of operations

1. PR #350 (dotenv) — done
2. PRs #2 + #3 (useBuddyVoice refs + no-explicit-any) — quick wins, parallel safe
3. PR #4 (DealPricingClient hooks) — after Matt picks F1 vs F2
4. PRs #5/#6/#7 — discover and fix as we reach them

## Non-goals

- Broad eslint config softening
- `if: always()` patches to SD-C's CI step
- Bundling unrelated fixes into one PR
- Auto-fix runs that touch unrelated files

## Done condition

`pnpm typecheck && pnpm lint && pnpm test:unit && pnpm guard:all` all
green on `main`. Schema drift detection runs end-to-end on every CI run.
SD-C Phase 2 (blocking flip in SD-A's PR) becomes actionable.
