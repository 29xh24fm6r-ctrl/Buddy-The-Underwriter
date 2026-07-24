# AAR — "One source of truth for financial calculations: finengine"

**Date:** 2026-07-14
**Directive:** "Buddy should have only one source of truth for Financial calculations and that is the FinEngine... we only want one source of truth in order to avoid creating chaos throughout the system as a whole."
**Status:** ✅ Every DSCR/equity-injection threshold hardcode found in the Brokerage SBA calculation stack now resolves from finengine's policy registry. The previous verification pass's own finding — "the whole Brokerage stack has zero finengine imports" — is now false for the specific numbers this directive is about (credit-policy thresholds). Full engine-level migration (replacing the forward model's projection/revenue math wholesale) is a larger, separate undertaking — see "What's still open" below.

---

## What "chaos" actually looked like

Before this pass, the SBA 7(a)/504 DSCR floor and equity-injection minimum were each hardcoded **independently in at least nine places**, several disagreeing with each other and with current SOP 50 10 8:

| File | What it hardcoded | Was it right? |
|---|---|---|
| `newBusinessProtocol.ts` | DSCR 1.25/1.10, equity 20%/10% | Equity floor wrong (fixed earlier today, see T0/T1) |
| `financialViabilityAnalysis.ts` | its own `isNewBusiness ? 0.2 : 0.1` equity check | Wrong (fixed earlier today) |
| `sbaSourcesAndUses.ts` | flat equity floor `0.10` | Right value, but a second copy |
| `sbaForwardModelBuilder.ts` | `SBA_DSCR_THRESHOLD = 1.25` | Right for new business, **wrong for established** (no business-age distinction at all) |
| `sbaPackageOrchestrator.ts` | its **own separate** `SBA_DSCR_THRESHOLD = 1.25`, plus its **own separate** `isNewBusiness = yearsInBusiness < 2` (not the canonical detector) | Same established-business bug, independently |
| `sbaGlobalCashFlow.ts` | `SBA_DSCR_THRESHOLD = 1.25` for `meetsSbaThreshold` | Same bug, third copy |
| `sbaPackageRenderer.ts` | `SBA_DSCR_THRESHOLD = 1.25`, used in 8 places (metric tiles, chart, table coloring, sensitivity table, narrative text) | Same bug, fourth copy — this is the PDF a lender opens |
| `sbaBorrowerPDFRenderer.ts` | its own `SBA_DSCR_THRESHOLD = 1.25`, 4 usage sites | Same bug, fifth copy — the PDF a borrower downloads |
| `ProjectionDashboard.tsx` | `DSCRGauge`'s default prop `1.25`, `ScenarioDscrCell`'s inline `1.25` | Same bug, sixth copy, client-side |
| `sbaActionableRoadmap.ts` | `input.dscrDownside >= 1.25`, `input.dscrYear1 >= 1.25` in deterministic fallback narrative | Same bug, seventh copy |

**The concrete, live consequence:** an established business (>24 months old) with a real DSCR of, say, 1.15x-1.20x would be told by the forward model, the PDF, the dashboard, and the fallback narrative that it's "below the SBA minimum" — using the *new-business* 1.25x standard it doesn't need to meet — while the actually-correct threshold for an established small 7(a) loan is 1.10-1.20x depending on loan size. Nine independent copies of the same number, several silently wrong, is exactly the "chaos throughout the system" the directive named.

## What changed

### 1. finengine's registry now models business age (additive, non-breaking)

`finengine/contracts.ts`: added `PolicyContext.isNewBusiness?: boolean` — a deal characteristic, same category as `productId`, ignored by every axis except the one that defines a variant for it.

`finengine/policyRegistry.ts`: `dscr_floor`'s axis definition gained a `newBusiness: { regulatoryFloor: 1.25, ... }` variant, checked with priority over `byProduct` in `layerFor()` when `ctx.isNewBusiness` is true (SOP's new-business standard applies uniformly across 7(a) small/standard/504, unlike the established-business floor which does vary by loan-size tier). 6 new tests in `policyRegistry.test.ts` pin the precedence (new-business override wins over byProduct; tenant override still wins over both; unaffected axes are unaffected).

### 2. `newBusinessProtocol.ts` — no longer hardcodes anything

`assessNewBusinessRisk()` now calls `resolvePolicy("dscr_floor", ...)` and `resolvePolicy("equity_injection_min", ...)` instead of the local `SBA_7A_DSCR_*`/`EQUITY_FLOOR_*` constants. Added `resolveProductId()`, which reuses the existing `detectSBAProgram()` (already canonical, already used by `sbaPackageOrchestrator.ts`) plus the same $350k SBA-7(a)-small-loan threshold `dealDataBuilder.ts`'s `is_7a_small_loan` already uses, so a deal's actual SBA program + loan size maps onto the correct finengine `productId` rather than a flat default. This module's own job now is exactly the SBA-domain logic finengine doesn't own: detecting new-business status from operating-history facts, and the resulting business-plan/management-experience blockers — not the threshold *values*.

**A real behavior change, stated plainly:** for an established small 7(a) loan, the DSCR floor moves from the old flat 1.10 to the registry's resolved 1.2 (institutional overlay above the 1.10 regulatory floor — the bank's actual policy, not just the bare regulatory minimum). This is a *stricter* number, not a *weaker* one — the same conservative direction every fix in this spec has taken. 7 tests in `newBusinessProtocol.test.ts` pin the exact resolution for small/standard/504/new-business/unknown-program cases.

### 3. Every calculation and threshold check migrated to call the registry/finengine's math functions

- `sbaSourcesAndUses.ts`: `minimumPct` now calls `resolvePolicy("equity_injection_min")` instead of a local `0.10` literal.
- `sbaForwardModelBuilder.ts`: `buildBaseYear`/`buildAnnualProjections`'s DSCR division now calls `finengine/metrics/ratios::dscr()` (preserving the existing 99-sentinel behavior for zero debt service at the call site, not inside finengine). `buildSensitivityScenarios` gained a `dscrThreshold` parameter (default: finengine's flat resolution, never a bare literal) replacing the removed module constant.
- `sbaPackageOrchestrator.ts`: replaced its own ad-hoc `isNewBusiness = yearsInBusiness < 2` with the canonical `detectNewBusinessFromFacts`/`assessNewBusinessRisk` pair (same one `sbaRiskProfile.ts` and `feasibilityEngine.ts` already use), extended its facts query to also fetch `MONTHS_IN_BUSINESS`/`BUSINESS_DATE_FORMED`, hoisted the `deals` query earlier so `deal_type`/`loan_amount` are available for productId resolution, and threads the resolved `projectedDscrThreshold` into both `buildSensitivityScenarios` and `dscrBelowThreshold` — fixing the live established-business-DSCR bug, not just relocating the hardcode.
- `sbaGlobalCashFlow.ts`: `computeGlobalCashFlow` now calls `finengine/metrics/ratios::globalDscr()` for the division (preserving the existing `0` sentinel) and resolves `meetsSbaThreshold`'s floor from the registry.
- `sbaPackageRenderer.ts` (the **final lender-facing PDF**): added `RenderInput.dscrThreshold`, threaded from the orchestrator's resolved value; all 8 internal usage sites (key-metrics tiles, DSCR chart, projections table coloring, sensitivity table + column header, executive-summary narrative text) now read it via a `resolveDscrThreshold()` helper instead of the removed constant.
- `sbaBorrowerPDFRenderer.ts` + its caller `generate-pdf/route.ts` (the **borrower-facing PDF**): same pattern — added `BorrowerPDFInput.dscrThreshold`; the route now runs its own `detectNewBusinessFromFacts`/`assessNewBusinessRisk` (extending its fact query the same way the orchestrator's was extended) rather than defaulting to a flat resolution, so this PDF gets the same deal-specific precision as the main one.
- `sbaActionableRoadmap.ts`: `RoadmapInput.dscrThreshold` added; the deterministic fallback narrative's `downsideOk`/"strong vs solid" branching now compares against it instead of a bare `1.25`.
- `ProjectionDashboard.tsx` (client-side live dashboard): `DEFAULT_DSCR_THRESHOLD` computed once via `resolvePolicy("dscr_floor").effective` (finengine is confirmed browser-safe — pure, no `server-only`, no Node built-ins, already proven by `useFinengineSpread.ts`'s existing client usage elsewhere in this app) — both the gauge's default prop and the scenario-cell color threshold now read from it instead of two separate `1.25` literals, so this dashboard can never show a different color than the PDF generated from the same data.

### What was deliberately left out of scope

- **`sbaConceptExplainer.ts`** and the DSCR-context lines inside `sbaBusinessPlanRoadmap.ts`'s Gemini prompt text: these are general borrower-education glossary copy and LLM prompt context, not a deal-specific pass/fail decision rendered to a user. Rewriting static "SBA lenders require 1.25x" glossary prose to be conditionally deal-specific would be scope creep beyond what this directive is about (calculations, not educational copy).
- **Wholesale migration of the forward model's projection/revenue/EBITDA math** (`buildAnnualProjections`'s revenue compounding, COGS, depreciation, tax logic) onto finengine's own methods (`finengine/methods/*`, `finengine/projections/projectionEngine.ts`). Only the DSCR division and the threshold values moved — the surrounding business-plan forecasting logic is Brokerage-specific projection modeling finengine doesn't have an equivalent for today. Migrating that is a much larger, separate architectural project (would mean rebuilding the SBA forward model's revenue-stream/capex/hiring logic against finengine's `CashFlowMethod` interface) — flagging as a real follow-up, not attempted here.
- **`buddySbaScore.ts`/`scoringCurves.ts`'s composite scoring** — these bucket already-computed values (DSCR, equity %, etc.) into a 0-5 proprietary score, a different kind of "calculation" (a scoring rubric) than the DSCR/equity arithmetic finengine owns. Not migrated; finengine has no equivalent scoring-curve concept to migrate onto.

## Verification

- `npx tsc -p tsconfig.json --noEmit` — clean, every step of the way.
- `pnpm test:unit` (full suite) — **11,565 passed, 0 failed, 9 skipped** (pre-existing), final run after all changes.
- All four finengine CI guards re-run and green: `guard-finengine-legacy-imports` (still 7 known Underwriter-cockpit consumers, unchanged — this pass didn't touch that ledger), `guard-finengine-provenance-stamp`, `guard-finengine-policy-registry`, `guard-finengine-memo-wall`.
- New/updated tests: `policyRegistry.test.ts` (+6), `newBusinessProtocol.test.ts` (updated + expanded to 7 DSCR-resolution cases pinning small/standard/504/new-business/unknown-program behavior).
- Grepped the entire `src/lib/sba/` tree and the two PDF renderers for `SBA_DSCR_THRESHOLD`/bare `1.25`/`0.20` after the change: zero hardcoded credit-policy-value duplicates remain in the calculation and rendering paths (only the deliberately-scoped-out educational-copy files noted above still contain the number as prose).
