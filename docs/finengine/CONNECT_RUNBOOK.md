# Connect-to-one-engine runbook (burn-down to 100%)

**Spec:** SPEC-BUDDY-FINENGINE-QUARANTINE-AND-CONNECT-1 (Part C — reference).
Each step below is its **own gated PR** (per SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1's one-phase-per-PR
discipline). This PR does **none** of them — it only audits + ring-fences.

## State today
- finengine merged, additive, shadow-mode; cutover flags all OFF.
- Legacy ACTIVE-PRODUCERS own 100% of live canonical facts (engine attribution null on all rows).
- Ring-fence guard active: `legacy-import-ledger.json` has **7** consumer entries (target 0).

## Burn-down sequence

1. **Phase 0 backfill** (verified safe; golden-run rows backed up in
   `public.zz_finengine_golden_run_backup_20260627`, 23 rows). Stamp provenance, wire the conflict
   ledger, remove golden-run. Run:
   `pnpm tsx --conditions=react-server scripts/finengine-phase0-backfill.ts --execute`
   then re-run the ELITE-1 §0.a–§0.d checks.

2. **Stand up the shadow run.** Execute `src/lib/finengine/shadow/reconcile.ts` across all live
   deals; classify each divergence INTENDED / ZERO / UNEXPECTED; resolve every UNEXPECTED. Pre-register
   the OmniCare C-corp DSCR and the multi-OPCO double-count fixes as INTENDED. (After the Phase 0
   backfill OmniCare loses its 23 synthesized facts and reads unresolved/low until the core produces
   real values — expected.)

3. **Per metric/product, in dependency order** (leaf metrics first):
   `EBITDA → ANNUAL_DEBT_SERVICE → DSCR → GLOBAL_CASH_FLOW → DSCR_STRESSED_300BPS → risk rating`.
   For each: make the core the writer behind the product's cutover flag → migrate readers off the
   legacy producer import → flip the flag ON → verify live → **remove that importer from
   `legacy-import-ledger.json`** (the guard burns down by one). Concretely the 7 ledger consumers:
   - `gcf/route.ts`, `financial-snapshot/recompute/route.ts`, `spreadsProcessor.ts` → off `persistGlobalCashFlow`, onto `finengine/methods/global`.
   - `pricing-assumptions/route.ts`, `spreadsProcessor.ts`, `ensureFinancialReadinessPrerequisites.ts` → off `computeTotalDebtService`, onto `finengine/metrics` + `debtEngine`.
   - `underwriting-synthesis/run/route.ts` → off `runCanonicalUnderwritingSynthesis`, onto `finengine/{collateral,sizing}`.

4. **When `legacy-import-ledger.json` is empty:** enable guard G3 (single writer per metric), delete
   the quarantined ACTIVE-PRODUCER files (`persistGlobalCashFlow`, `computeGlobalCashFlow`,
   `computeTotalDebtService`, `materializeDebtServiceFact`, `runCanonicalUnderwritingSynthesis`),
   collapse `financial_snapshots*`, and re-home the SHARED-PRIMITIVE-KEEP modules (`debtEngine`,
   `creditMetrics`, `consolidation`, `ratios`, `modelEngine`, `spreads` view-model, and the
   `financialIntelligence` pure engines `ebitdaEngine`/`officerCompEngine`/`entityTaxForm`) under the
   core's primitive set. Only here is "100% connected, legacy quarantined" true.

## Out of scope forever (not finengine replacements)
Document extraction (`financialSpreads/extractFactsFromDocument`), PDF/spreadsheet rendering
(`classicSpread`, `spreadOutput`) — NG2 of ELITE-1. These stay; they are not on the quarantine ledger.
