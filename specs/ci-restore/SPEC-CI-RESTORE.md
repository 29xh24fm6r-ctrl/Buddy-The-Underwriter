# SPEC CI-RESTORE — Pre-existing CI debt cleanup

**Date:** 2026-04-27 · **Owner:** Architecture (Matt) · **Executor:** Claude Code
**Status:** in progress · **Total est:** 1.5–2 days for blockers 1–5; **blocker #6 is its own multi-day project, not bundled**

## Background

Pre-existing failures on `origin/main` cascade-skip `Schema drift detection`
(SD-C) on every CI run. Discovered while attempting SD-C's first
post-merge drift report (commit `e49af672`). Each blocker gets its own
scoped PR; no bundling, no broad lint config softening, no `if: always()`
workflow patches.

SD-A is unblocked separately via Track 1 (Supabase MCP one-shot drift run
committed to repo at `specs/schema-drift/SD-C-first-report-2026-04-27.json`).
This spec tracks the parallel CI-greenness work.

## Blockers

| # | Blocker | Status | PR | Effort | Notes |
|---|---|---|---|---|---|
| 1 | Typecheck — missing `dotenv` direct dep | ✅ done | #350 | 5 min | Promoted from transitive |
| 2 | Lint — `useBuddyVoice.ts` refs-during-render (×2) | ✅ done (pending push) | TBD | ~15 min | Bundled with `tokenEndpoint` dep fix (same hook, same root cause) |
| 3 | Lint — `no-explicit-any` (×8 across 3 files) | ✅ done (pending push) | TBD | ~30 min | Real types where obvious; targeted disable + comment otherwise. **OmegaAdvisoryAdapter shape mismatch (`conf.data?.score` vs actual `{ ok, confidence }`) is a real caller bug captured in disable comment — tracked as separate follow-up below** |
| 4 | Lint — `DealPricingClient.tsx` hooks-rules (×22) | ⏳ next | TBD | ~45 min | Real runtime bug. F1 outer-gate split authorized |
| 5 | Architectural guards | ⏳ unknown | TBD | TBD | Surface findings when we reach this step |
| 6 | **Unit tests — 47 pre-existing failures (NOT 4)** | ⏳ deferred | — | **Multi-day project** | See "Blocker #6 — corrected scope" below |
| 7 | `Buffer<ArrayBufferLike>` (from prior CI-RESTORE memory) | ⏳ unknown | TBD | TBD | Look up original context |

## Blocker #6 — corrected scope

**Original spec assumption (WRONG):** the original draft estimated 4
known unit test failures — `useBuddyVoice`, `redaction.server`,
`intakeCockpitHardeningGuard`, `trustLayerGuard` — and treated #6 as a
small fix in a single PR.

**Reality (verified during PR #2/#3 verification on 2026-04-27):**
test:unit on `origin/main` shows **2403 passing, 47 failing**. The 4
originally listed names are *historical examples* — real members of the
47, but a small subset, not the bulk. Treating this as a single-PR fix
is unsafe — most failures are not yet diagnosed, and at least some are
likely to be:

- Tests asserting against old contracts that changed (and the test
  file was missed in the change)
- Tests that need their own debt-paydown work (mocking, fixture rot,
  flake)
- Tests that reveal real product bugs the team hasn't seen because CI
  was silently red

**Implication:** Blocker #6 is a separate, multi-day project that should
be scoped on its own — likely a subsequent spec (`SPEC-TEST-DEBT.md`)
that buckets the 47 failures by root cause class and assigns each
bucket its own remediation pattern. **Do not block CI green on fixing
all 47 failures in one push.**

**For the immediate CI-RESTORE goal** (unblock the Schema drift
detection step), one of two paths:

- **(A) Make `pnpm test:unit` non-blocking for the SD-C step only** by
  reordering steps in `.github/workflows/ci.yml` — SD-C runs after lint
  + typecheck but does not depend on test:unit. This is a workflow
  surgery decision, not a "soften test:unit" decision. Document the
  rationale in the workflow file itself.

- **(B) Quarantine the 47 failures via skip + tracking issue, ship CI
  green, then drain the quarantine over time.** Higher-touch but more
  honest about the actual debt.

Decision deferred until blockers 1–5 land and Matt + Claude can scope
blocker #6 cleanly.

## Tracked follow-ups (out of scope for CI-RESTORE)

- **OmegaAdvisoryAdapter shape mismatch.** The caller code reads
  `conf.data?.score` and `tr.data?.id`, but `evaluateOmegaConfidence`
  returns the flat shape `{ ok, confidence }` (no `.data`, no `.score`)
  and `recordOmegaTrace` returns `OmegaResult<OmegaTraceEntry[]>` (no
  `.data?.id`). This means `getOmegaAdvisoryState` is silently producing
  garbage advisory output. Discovered during PR #3 (no-explicit-any)
  while writing the disable comment. The Omega integration spec
  already flags adapter fields like `conf.data?.score` as guesses from
  when the endpoint never returned real data; this is the concrete
  manifestation. **Track as its own roadmap item — multi-file caller
  refactor, not a lint fix.**

## Order of operations

1. PR #350 (dotenv) — done
2. PRs #2 + #3 (useBuddyVoice refs + no-explicit-any) — done, push pending
3. PR #4 (DealPricingClient hooks) — F1 outer-gate split authorized
4. PR #5 (architectural guards) — discover and surface
5. PR #7 (`Buffer<ArrayBufferLike>`) — look up context, fix
6. **STOP here for CI-greenness review.** Decide blocker #6 path
   (A vs B vs full debt-paydown spec) before touching test:unit.

## Non-goals

- Broad eslint config softening
- `if: always()` patches to SD-C's CI step
- Bundling unrelated fixes into one PR
- Auto-fix runs that touch unrelated files
- **Treating blocker #6 as a small fix** — it is its own project, scope it separately

## Done condition

`pnpm typecheck && pnpm lint && pnpm guard:all` all green on `main` —
and either `pnpm test:unit` is green OR a documented decision exists
about blocker #6 (path A or B above) with the SD-C step explicitly
unblocked. Schema drift detection runs end-to-end on every CI run.
SD-C Phase 2 (blocking flip in SD-A's PR) becomes actionable.
