# Legacy engine connection audit & import inventory

**Spec:** SPEC-BUDDY-FINENGINE-QUARANTINE-AND-CONNECT-1
**Generated from:** `main @ aeec1d0` (2026-06-27)
**Scope:** audit + ring-fence only. No runtime behavior change, no flag flips, no legacy
deletion, no backfill/shadow run (NG1–NG4).

---

## §0 — verification

- **Cutover flags:** all `false` in `src/lib/finengine/featureFlags.ts::DEFAULT_CUTOVER_FLAGS`
  (CI_TERM, SBA_7A_STANDARD/SMALL, SBA_504, ABL_REVOLVER, WORKING_CAPLINE, CRE_OWNER_OCC,
  CRE_INVESTOR). finengine is live for **zero** products. ✅ STOP condition (any flag ON) not tripped.
- **finengine produces zero canonical facts wired to a product:** confirmed by the import audit
  below — no consumer of `src/lib/finengine/*` writes facts on a live path; the only fact-write
  chokepoint (`writeFact.ts`) is reached exclusively by legacy producers.
- **Connection state (DB):** established in the SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 §0 earlier this
  session — `provenance->>'engine'` null on all 1,185 `deal_financial_facts` rows; legacy owns 100%
  of live values. The Phase 0 backfill was **not** run (NG3), so this is unchanged. (Live SQL
  re-run via the Supabase MCP was blocked by an unstable project-ref this session; the value above
  is from the same project earlier today and nothing has mutated it.)

**Conclusion:** "100% connected" is currently **0%, by design**. This PR ring-fences the legacy
producers and records the burn-down ledger; cutover happens in later gated PRs (CONNECT_RUNBOOK.md).

---

## Part A — producer register (evidence-based classification)

Classification key: **ACTIVE-PRODUCER** (writes canonical credit facts finengine replaces) ·
**SHARED-PRIMITIVE-KEEP** (pure math the core imports) · **RENDER/UI-OTHER** (presentation /
extraction, not a credit-number producer) · **DORMANT/DEAD**.

| Module | Class | Writes `deal_financial_facts`? | Entry file(s) |
|---|---|---|---|
| `structuralPricing/` | **ACTIVE-PRODUCER** | Yes — ANNUAL_DEBT_SERVICE, DSCR, DSCR_STRESSED_300BPS | `computeTotalDebtService.ts`, `materializeDebtServiceFact.ts` |
| `financialIntelligence/` | **ACTIVE-PRODUCER** (mixed; see note) | Yes — GCF_GLOBAL_CASH_FLOW, GCF_DSCR | `persistGlobalCashFlow.ts`, `computeGlobalCashFlow.ts` |
| `underwritingSynthesis/` | **ACTIVE-PRODUCER** | Yes — collateral / sources&uses / aliases (synthesis:*) | `runCanonicalUnderwritingSynthesis.ts` |
| `financialSpreads/` | ACTIVE-PRODUCER **(extraction stays — out of finengine scope, NG2 of ELITE-1)** | Yes — extracted document facts + deal_spreads backfill | `extractFactsFromDocument.ts`, `renderSpread.ts` |
| `classicSpread/` | RENDER/UI-OTHER | No (writes `deal_spreads` PDF cache, not credit facts) | `classicSpreadLoader.ts`, `classicPdfWorker.ts` |
| `spreadOutput/` | RENDER/UI-OTHER | No | `index.ts`, `narrativeComposer.ts` |
| `spreads/` | SHARED-PRIMITIVE-KEEP (view-model) | No | `buildCanonicalSpreadViewModel.ts` |
| `creditMetrics/` | SHARED-PRIMITIVE-KEEP | No | `index.ts` |
| `modelEngine/` | SHARED-PRIMITIVE-KEEP | No | `index.ts` |
| `underwritingEngine/` | SHARED-PRIMITIVE-KEEP (orchestrator) | No | `index.ts` |
| `ratios/` | SHARED-PRIMITIVE-KEEP | No | `altmanZScore.ts`, … |
| `consolidation/` | SHARED-PRIMITIVE-KEEP | No | `consolidationEngine.ts` |
| `debtEngine/` | SHARED-PRIMITIVE-KEEP (amortization) | No | `index.ts` |

**`financialIntelligence/` is MIXED.** It contains the ACTIVE-PRODUCER GCF writers
(`persistGlobalCashFlow`, `computeGlobalCashFlow`) **and** the SHARED-PRIMITIVE-KEEP pure engines
`ebitdaEngine`, `officerCompEngine`, `entityTaxForm` — which **finengine itself imports**
(`src/lib/finengine/methods/foundation.ts`). The quarantine therefore targets the specific
**producer files**, not the directory, so finengine's legitimate primitive imports are not flagged.

**Reclassifications vs. the spec's starting table (findings):**
- `spreads/` (V1) — the spec listed it ACTIVE-PRODUCER; the audit found it a pure view-model
  builder with **no fact writes** → SHARED-PRIMITIVE-KEEP. Not quarantined here.
- `classicSpread/` — listed ACTIVE-PRODUCER; it is a PDF renderer writing `deal_spreads`, not
  canonical credit facts → RENDER/UI-OTHER. Not quarantined here (matches ELITE-1 Phase 6, which
  keeps the classicSpread renderer as presentation).
- `computed:classic_spread:*` and `synthesis:golden_run:*` source_refs exist on **live DB rows**
  but **no active code path produces them** (grep-clean) — the producers were already refactored
  away; the rows are historical. Their replacement is finengine, tracked in the coverage map.

### Legacy source_ref → producer file
| source_ref | producer file | line |
|---|---|---|
| `computed:noi/total_debt` | `structuralPricing/computeTotalDebtService.ts` | ~252 |
| `computed:noi/stressed_total_debt` | `structuralPricing/computeTotalDebtService.ts` | ~346 |
| `computed:gcf/total_debt` | `structuralPricing/computeTotalDebtService.ts` | ~308 |
| `deal_structural_pricing:*` | `structuralPricing/{computeTotalDebtService,materializeDebtServiceFact}.ts` | ~182 / ~34 |
| `total_debt:*` | `structuralPricing/computeTotalDebtService.ts` | ~210 |
| `computeGlobalCashFlow:v2` / `deal_spreads:GLOBAL_CASH_FLOW` | `financialIntelligence/persistGlobalCashFlow.ts` | — |
| `synthesis:canonical_alias:*`, `synthesis:collateral:*`, `synthesis:sources_uses:*`, `synthesis:ar_borrowing_base:*` | `underwritingSynthesis/runCanonicalUnderwritingSynthesis.ts` | ~440 / ~406 / ~365 / ~474 |
| `deal_spreads:*` (T12/BS/PFS backfill) | `financialSpreads` backfill path | — |
| `synthesis:golden_run:*` | (no active producer — historical rows only) | — |
| `computed:classic_spread:v2` | (no active producer — historical rows only) | — |

---

## Quarantined set (ring-fenced this PR)

The guard `scripts/guards/guard-finengine-legacy-imports.mjs` (in `guard:all`) ring-fences imports of
these **producer files**; the burn-down ledger is `docs/finengine/legacy-import-ledger.json`.

| Producer (quarantined import) | Live consumers (the ledger) |
|---|---|
| `@/lib/financialIntelligence/persistGlobalCashFlow` | `app/api/deals/[dealId]/gcf/route.ts` (static); `app/api/deals/[dealId]/financial-snapshot/recompute/route.ts` (dynamic); `lib/jobs/processors/spreadsProcessor.ts` (dynamic) |
| `@/lib/financialIntelligence/computeGlobalCashFlow` | (internal to persistGlobalCashFlow) |
| `@/lib/structuralPricing/computeTotalDebtService` | `lib/jobs/processors/spreadsProcessor.ts` (dynamic); `app/api/deals/[dealId]/pricing-assumptions/route.ts` (dynamic); `lib/financialReadiness/ensureFinancialReadinessPrerequisites.ts` (static) |
| `@/lib/structuralPricing/materializeDebtServiceFact` | (internal to computeTotalDebtService) |
| `@/lib/underwritingSynthesis/runCanonicalUnderwritingSynthesis` | `app/api/deals/[dealId]/underwriting-synthesis/run/route.ts` (static) |

**Legacy producer consumers remaining: 7** (target 0). Each consumer serves the underwrite /
pricing / GCF surfaces and migrates to finengine per the runbook; when the ledger is empty the
producers are deletable (later PR).

---

## Coverage map — connect-to-100% checklist

For each canonical metric: current producer → finengine replacement.

| Canonical metric | Current producer | finengine replacement |
|---|---|---|
| `EBITDA` / `ADJUSTED_EBITDA` | `financialFacts/computeBusinessEbitdaFacts` (via `financialIntelligence/ebitdaEngine` — a KEEP primitive) | `finengine/methods/adjustedEbitda` (wraps the same primitive) |
| `ANNUAL_DEBT_SERVICE` (+ proposed/existing) | `structuralPricing/computeTotalDebtService`, `materializeDebtServiceFact` | `finengine/metrics` + `debtEngine` |
| `DSCR` | `structuralPricing/computeTotalDebtService` (`computed:noi/total_debt`) | `finengine/metrics/ratios::dscr` (global denominator) |
| `DSCR_STRESSED_300BPS` | `structuralPricing/computeTotalDebtService` (`computed:noi/stressed_total_debt`) | `finengine/stress/stressEngine` |
| `GLOBAL_CASH_FLOW` / `GCF_DSCR` / `GCF_GLOBAL_CASH_FLOW` | `financialIntelligence/persistGlobalCashFlow` | `finengine/methods/global` + `entityGraph` |
| collateral set (`COLLATERAL_*`, `LTV_*`) | `underwritingSynthesis/runCanonicalUnderwritingSynthesis` | `finengine/collateral` |
| sources&uses set (`BANK_LOAN_TOTAL`, `BORROWER_EQUITY`, `EQUITY_INJECTION`) | `underwritingSynthesis/runCanonicalUnderwritingSynthesis` | `finengine/sizing` |
| AR / borrowing-base set | `underwritingSynthesis` + `processors/arCollateralProcessor` | `finengine/collateral` (AR eligibility) + `finengine/sizing` (borrowing base) |
| risk rating / classification | (none canonical today) | `finengine/riskRating` (new) |
| covenants / monitoring | (none canonical today) | `finengine/covenants` (new) |

---

## Appendix — broad import sweep (context, not all quarantined)

Non-test importers by module (full `from "@/lib/<module>"` sweep): `financialSpreads` 116,
`modelEngine` 64, `classicSpread` 31, `spreads` 20, `financialIntelligence` 17, `creditMetrics` 17,
`underwritingEngine` 12, `spreadOutput` 12, `ratios` 6. Only the **producer files** within
`structuralPricing` / `financialIntelligence` / `underwritingSynthesis` are quarantined (7 consumer
pairs); the rest are SHARED-PRIMITIVE-KEEP or RENDER/extraction and are intentionally **not**
ring-fenced (they are not credit-number producers finengine replaces, so their ledger could never
reach empty).

---

## Addendum — 2026-07-14 (SPEC-BROKERAGE-SBA-READY-V1 verification pass)

Asked to verify all financial calculations run through finengine. Two findings not previously
recorded anywhere in this doc:

1. **The entire Brokerage/SBA-package stack is outside this inventory's scope, not just
   unmigrated within it.** `src/lib/sba/*`, `src/lib/feasibility/*`, and `src/lib/score/*` — the
   forward model (`sbaForwardModelBuilder.ts`), feasibility study (`feasibilityEngine.ts`,
   `financialViabilityAnalysis.ts`), and Buddy SBA Score (`buddySbaScore.ts`, `scoringCurves.ts`)
   — have **zero imports of `@/lib/finengine` anywhere** (confirmed by grep) and are not listed as
   a classified module in Part A above. This is a separate, parallel DSCR/equity-injection/
   debt-service calculation system this audit never inventoried, not an approved exception to it.
   Whether it should eventually migrate onto finengine (there's real overlap — `finengine/sba/`,
   `finengine/sizing/size504`, `finengine/metrics/ratios::dscr` already exist) is a product/
   architecture decision, not made here.
2. **Fixed:** `finengine/sba/eligibility.ts`'s own future SBA eligibility check had the field
   `ownersUsCitizenOrLpr: boolean`, whose PASS condition was "Owners are US citizens / LPR" —
   the same pre-2026-03-01 citizenship rule already found and fixed this same day in
   `src/lib/sba/dealDataBuilder.ts`'s `ELIGIBLE_CITIZENSHIP_STATUSES` (see
   `docs/archive/brokerage-sba-ready-v1/T0-findings.md` item 2). SBA Procedural Notice 5000-876626
   (eff. 2026-03-01) makes lawful permanent residents categorically ineligible owners — this
   module's own doc comment already cited that effective date, but the logic hadn't been updated
   to match. Renamed to `ownersUsCitizenOrNational`, corrected the PASS/FAIL semantics, added a
   regression test. Not live (only `finengine/__tests__/phase5.test.ts` imported it), so no
   current deal was affected — but it would have shipped the wrong rule the moment finengine's
   SBA eligibility cuts over. Full writeup: `docs/archive/brokerage-sba-ready-v1/T2-finengine-verification-AAR.md`.
