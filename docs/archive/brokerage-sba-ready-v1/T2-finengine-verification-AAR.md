# AAR — "Verify all financial calculations run through finengine"

**Date:** 2026-07-14
**Status:** ✅ Verification complete. One concrete bug found and fixed. One architectural gap documented, not fixed (needs a product decision, not a unilateral rewrite).

---

## The ask

Verify that all financial calculations run through the one Financial Engine (`src/lib/finengine/`) recently built for Buddy.

## What was actually verified

1. **finengine's own documented status:** live for zero products by design. All cutover flags (`featureFlags.ts::DEFAULT_CUTOVER_FLAGS`) are `false`. `docs/finengine/LEGACY_IMPORT_INVENTORY.md` states plainly: "100% connected is currently 0%, by design." It runs in shadow mode (parallel computation for verification — `FinengineBalanceSheetPanel.tsx`, `useFinengineSpread.ts`, a shadow credit-memo path) but nothing has cut over to it as the source of truth.

2. **The Underwriter-cockpit legacy producers finengine is meant to replace** (DSCR/ADS via `structuralPricing/computeTotalDebtService.ts`, global cash flow via `financialIntelligence/persistGlobalCashFlow.ts`, collateral/sources&uses via `underwritingSynthesis/runCanonicalUnderwritingSynthesis.ts`) are ring-fenced by an approved-violations ledger (`docs/finengine/legacy-import-ledger.json`, 7 known consumers) and a CI guard that fails on any new/stale entry. Ran it: **passes clean.** Ran the other three finengine guards too (provenance-stamp, policy-registry, memo-wall): **all pass.** This part of the system is honestly tracked, not silently drifting.

3. **The Brokerage/SBA-package stack has zero connection to finengine — and isn't even in its inventory.** Grepped every file under `src/lib/sba/`, `src/lib/feasibility/`, `src/lib/score/` for `@/lib/finengine` imports: zero hits. This is the entire calculation surface this session's earlier work touched — `newBusinessProtocol.ts`'s equity-injection floor and DSCR thresholds, `feasibilityEngine.ts`/`financialViabilityAnalysis.ts`'s DSCR/capitalization scoring, `sbaForwardModelBuilder.ts`'s forward-model DSCR, `buddySbaScore.ts`/`scoringCurves.ts`'s composite score, and today's own `existingDebtSchedule*.ts` debt-service aggregation. None of it is listed in `LEGACY_IMPORT_INVENTORY.md`'s Part A producer register — it's not an approved exception to the migration, it was never in scope of the audit that produced that register.

   **Not fixed here, and deliberately not attempted unilaterally:** whether this stack should migrate onto finengine is a real architecture call, not a bug fix. There's genuine overlap already sitting in finengine waiting to be reused — `finengine/sba/` (eligibility), `finengine/sizing/size504` (equity-injection stacking for 504), `finengine/metrics/ratios::dscr` (a global-denominator DSCR primitive) — but migrating `newBusinessProtocol.ts`/`feasibilityEngine.ts`/`sbaForwardModelBuilder.ts`/`buddySbaScore.ts` onto them is a substantial, multi-file refactor of live Brokerage code, not something to do as a drive-by "fix." Flagging for a deliberate decision, same as this repo's own convention for calls like this (see `docs/finengine/CONNECT_RUNBOOK.md`'s gated-PR approach for the Underwriter-side cutover).

## What was fixed

**`src/lib/finengine/sba/eligibility.ts`** — its own future SBA eligibility checker had a field `ownersUsCitizenOrLpr: boolean` whose PASS condition read "Owners are US citizens / LPR." This is the same bug already found and fixed today in `src/lib/sba/dealDataBuilder.ts`'s `ELIGIBLE_CITIZENSHIP_STATUSES` (see `T0-findings.md` item 2): SBA Procedural Notice 5000-876626, effective 2026-03-01, rescinded the prior rule and made lawful permanent residents categorically ineligible owners, full stop. This module's own doc comment already cited "as amended, eff. 2026-03-01 for citizenship/SBSS" — someone knew about the amendment, but the boolean's name and logic weren't updated to match it.

Renamed the field to `ownersUsCitizenOrNational`, corrected the PASS/FAIL detail text and the FAIL message to explicitly state the LPR exclusion, and added a regression test (`phase5.test.ts`) proving LPR ownership now fails eligibility. Left the separate "principal residence in the US" half of the same notice (which applies to citizens/nationals too, not just LPRs) out of scope here — that's the already-filed `specs/follow-ups/SPEC-BROKERAGE-SBA-READY-V1-principal-residence-certification.md`, and folding it into this fix would have silently expanded a narrow, well-understood bug fix into a half-built feature.

This module has exactly one consumer (`finengine/__tests__/phase5.test.ts` — confirmed by grep before the fix). It isn't live, so no current deal was affected. It would have shipped the wrong rule the moment finengine's SBA eligibility check cuts over to a real product.

## Verification

- `npx tsc -p tsconfig.json --noEmit` — clean.
- `node --test --import tsx src/lib/finengine/__tests__/phase5.test.ts` — 15/15 pass, including the new LPR regression case.
- `pnpm test:unit` (full suite) — **11,558 passed, 0 failed, 9 skipped** (pre-existing).
- All four finengine CI guards re-run and confirmed green: `guard-finengine-legacy-imports`, `guard-finengine-provenance-stamp`, `guard-finengine-policy-registry`, `guard-finengine-memo-wall`.
