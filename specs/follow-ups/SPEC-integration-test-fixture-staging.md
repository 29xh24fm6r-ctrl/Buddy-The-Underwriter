# SPEC: Integration Test Fixture Staging for Submission Flow

**Filed:** 2026-05 during SPEC-FLOW-V1 PR3 (#404)
**Originating PR:** #404

## Current state

`src/lib/creditMemo/submission/__tests__/lifecycleEventsAfterSubmit.integration.test.ts` walks the full submission flow against a real Supabase admin client and asserts the audit ledger has either `deal.lifecycle.advanced` or `deal.lifecycle.advance_attempted` after the call returns.

The test is env-gated: it **skips** when these env vars are absent:
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY`
- `PR3_INTEGRATION_TEST_BANK_ID`
- `PR3_INTEGRATION_TEST_BANKER_ID`
- `PR3_INTEGRATION_TEST_DEAL_ID`

**CI currently does not have these env vars staged.** Verified on PR #404's CI run — test reports `SKIP` with a structured message identifying all 5 missing env groups. This means V-7 (integration test passing) is NOT verified by CI. The structural tests (8 CI guard subtests + 5 lifecycle-integration structural subtests) carry source-level coverage; V-10 (post-deploy 24h check) carries behavioral verification.

## Why the test skips rather than fails

The test requires a **pre-staged deal at canonical `underwrite_in_progress` with all memo input readiness gates satisfied**. Staging that deal requires synthesizing 20+ tables of supporting data (financial facts, snapshots, research, pricing, memo inputs, management profiles, collateral items, etc.). That fixture is owned by broader test-environment infrastructure, not the test file itself.

Silently skipping when env vars are missing is correct: CI should not fail because a fixture isn't staged. The CI matrix should fail if all matrix shards skip — but we don't have a matrix shard with the fixture today.

## Two paths to fix

### Option A — Stage the fixture in a Supabase preview branch

Create a Supabase preview branch with the integration test fixture pre-loaded. Set the 5 env vars in the CI workflow's `env:` block (or in GitHub Actions secrets). The test runs against the preview branch during CI.

**Pro:** Real DB, behavioral correctness verified. **Con:** Preview branch must be maintained; fixture data can drift from schema changes; preview branch costs Supabase $$$ if always-on.

### Option B — Build a mock-Supabase variant of the integration test

Replace the real admin client with an in-memory mock that simulates the Supabase response for the insert + select path. The test becomes a hybrid: real submission logic, mocked persistence.

**Pro:** No external deps, runs everywhere, fast. **Con:** Mocking supabaseAdmin requires the same DI or module-mocking infrastructure described in `SPEC-submission-tests-behavioral-conversion.md` — so this follow-up is gated on that one.

## Recommended sequencing

1. **Short-term (now → PR5):** Accept skip. V-10 post-deploy check catches behavioral failure within 24h. Structural tests prevent source-level regression.
2. **Medium-term (vitest migration):** When vitest lands (per `node-24-test-discovery-paren-paths-quirk.md` recommendation), Option B becomes feasible — vitest's module mocking works with path aliases.
3. **Long-term (staging env):** When a persistent staging Supabase instance is available for CI, Option A gives the highest confidence.

## Status

- Filed: 2026-05
- Owner: unassigned
- Blocker for: nothing currently (V-10 post-deploy carries behavioral load)
- Gated on: vitest migration (for Option B) or staging env provisioning (for Option A)
- Estimated effort: ~2h for Option B once vitest is available; ~4h for Option A including CI wiring
