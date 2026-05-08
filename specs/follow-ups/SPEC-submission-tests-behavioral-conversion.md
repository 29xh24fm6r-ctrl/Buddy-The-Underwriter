# SPEC: Submission Tests — Behavioral Conversion

**Filed:** 2026-05 during SPEC-FLOW-V1 PR3 (#404)
**Originating PR:** #404

## Current state

The 5 structural subtests in `src/lib/creditMemo/submission/__tests__/submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts` are **source-pattern assertions**, not behavioral assertions. They verify the right code patterns exist (try/catch around `advanceDealLifecycle`, blocker mapping shape, snapshotId captured, no spurious return paths) by reading the helper file as text and matching regexes.

This covers source-level regression but NOT behavioral correctness. If the regex patterns match but the runtime behavior is wrong (e.g., a subtle scope issue, a thrown promise that isn't caught by the try/catch, or a race condition between the advance and the writeEvent), the structural tests will pass while the behavior fails.

## Why behavioral tests don't exist yet

Behavioral conversion requires **either**:

1. **Dependency injection in `submitCreditMemoToUnderwriting`** — export a factory or accept an optional `deps` parameter so tests can inject mock implementations of `advanceDealLifecycle`, `writeEvent`, and `supabaseAdmin`. This is a structural refactor of the submission helper and was explicitly out of scope for PR3 ("the spec's 'Out of scope' section explicitly bans refactoring beyond the lifecycle wiring itself").

2. **Reliable ESM module mocking via `t.mock.module()`** in the `node:test` runner with `tsx`. Node 22+ supports `t.mock.module()`, but it is unreliable in this codebase due to TypeScript path-alias resolution (`@/buddy/lifecycle/advanceDealLifecycle` etc.) — tsx resolves the aliases before `t.mock.module` intercepts them, and the mock never activates.

## When to convert

When **either** becomes available:
- Option 1: a future PR refactors `submitCreditMemoToUnderwriting` to accept optional deps → swap the 5 structural subtests for 3 behavioral subtests 1:1 (spec describes: success / blocked / threw).
- Option 2: the codebase migrates to vitest (recommended in `specs/follow-ups/node-24-test-discovery-paren-paths-quirk.md`) → vitest has robust module mocking that works with path aliases.

## What to preserve

The CI guard at `src/lib/creditMemo/__tests__/submissionLifecycleEventGuard.test.ts` (8 subtests) is not affected by this conversion — it remains source-level by design. The conversion applies only to the 5 structural subtests in `lifecycleIntegration.test.ts` that are standing in for the spec's behavioral test 1.

## Status

- Filed: 2026-05
- Owner: unassigned
- Blocker for: nothing currently (V-10 post-deploy check catches behavioral failure within 24h)
- Estimated effort: ~2h if DI route; ~4h if vitest migration route (vitest migration has broader benefits)
