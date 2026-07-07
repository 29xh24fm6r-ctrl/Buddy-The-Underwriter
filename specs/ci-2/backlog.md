# SPEC-CI-2 Backlog — surfaced by SPEC-CI-1 glob broadening
# Format: <file path or item> | <class> | <one-line reason> | <effort guess>
#
# SPEC-CI-1 broadened test:unit discovery (805 → ~936 reachable files) and wired
# test:invariants into CI. The reds below were surfaced but NOT fixed (Principle
# #13) — each is skipped-with-reason (grep `SPEC-CI-2`) so the CI signal is honest.
# Class A (regressions of SEC-1/FIN-TL-1/PORTAL-1) count was 0 — nothing blocking.

## Unit-test reds (Class B/C) — skipped in-file with `// SPEC-CI-2:` markers

src/core/nextStep/__tests__/computeNextStep.test.ts | C | imports a chain that pulls in `server-only`, unresolvable under node --test ("Cannot find module 'server-only'"); whole file quarantined in scripts/discover-tests.mjs | M (needs a server-only shim or test refactor)
src/core/omega/__tests__/omegaAdvisoryGuard.test.ts | B | "Omega guardrails — API routes" describe reads src/app/api/omega/{relationship,portfolio}/route.ts which do not exist (ENOENT); 5 tests | S (restore routes or delete suite)
src/evals/phase54Guard.test.ts | B | reads src/app/api/evals/run/route.ts + eval dashboard page which do not exist (ENOENT); 2 tests | S
src/lib/validation/phase53Guard.test.ts | B | "memo generate gate includes validation check" assertion no longer matches credit-memo/generate route wiring; 1 test | S
src/buddy/lifecycle/__tests__/pricingFinalizeUxGuard.test.ts | B | Guard 1/2 assert snapshot-missing + spreads-pending branches link to /spreads; client copy/markup drifted; 2 tests | S
src/components/journey/__tests__/JourneyRail.test.ts | B | asserts JourneyRail imports getNextAction, refactored away (audit finding); 1 test | S
src/components/journey/__tests__/spec07-precision-intelligence.test.ts | B | "V27: advisor panel does not call fetch (props-driven)" assertion falsy; 1 test | S
src/components/journey/__tests__/spec12-predictive-decision-quality.test.ts | B | "V1: committee_failure_risk emits with critical overrides" strict-equal mismatch; 1 test | S

## Invariants suite reds (Class B) — skipped in-file, wired into CI green

src/lib/intake/__invariants__/invariantDatabase.test.ts | B | Scenario C: confirm route references is_active only 2× (asserts ≥4); unrelated to audit criticals | S
src/lib/spreads/__invariants__/invariantSpreadConcurrency.test.ts | B | Scenario E: observer must set status=error on auto-heal | S
src/lib/spreads/__invariants__/invariantSpreadVersioning.test.ts | B | Scenario F: ALL_SPREAD_TYPES must have 7 members; Scenario G: STANDARD must have no template | S

## Orphaned guards found FAILING (not wired into guard:all — real violations)

scripts/admin-routes-guard.mjs (guard:admin) | guard | admin API routes lack a service-role/auth marker: reviews, tempo, whoami, … (several) | M — SPEC-GUARD-ADMIN-ROUTES-1
scripts/guard-no-deal-files.mjs (guard:canonical) | guard | src/components/ops/reminders/useRunsStream.ts uses legacy field `enabled` | S
scripts/guard-no-legacy-reminder-fields.mjs (guard:reminders) | guard | same useRunsStream.ts legacy `enabled` field | S
scripts/guard_no_direct_deal_documents_inserts.sh (guard:writers) | guard | src/app/api/deals/[dealId]/underwrite/start/route.ts:322 direct deal_documents select (count/head) | S — verify guard over-match vs real

## Structural (separate fix)

Test files under `(...)` / `[...]` paths (9) | struct | node --test runs 0 tests silently for route-group/dynamic-segment paths (memory #30); unreachable-by-runner regardless of glob | M — needs a runner-compatible relocation or a bracket-tolerant runner
src/lib/creditMemo/submission/__tests__/lifecycleEventsAfterSubmit.integration.test.ts | skip | env-gated t.skip (needs PR3_INTEGRATION_TEST_* + DB env); legitimate integration gate, left as-is per SPEC-CI-1 non-goal | —
