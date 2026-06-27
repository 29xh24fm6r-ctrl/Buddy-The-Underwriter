# SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 0 verification & evidence

**Phase:** 0 — Stop the bleeding (normalized provenance, conflict-ledger wiring,
golden-run removal, shadow-harness scaffold). Additive; **no computed value
changes.**
**Branch:** `claude/finengine-unified-core-ewptk1`
**Supabase project:** `sglhiuzgugbnzkymwnk` (live `main` corpus)
**Date verified:** 2026-06-27

---

## §0 — Problem still exists (mandatory pre-flight)

Run against live Supabase before any code. The §0 STOP condition (problem
already fixed) is **NOT** triggered — all three sub-conditions fail.

| Check | Query | Result | Verdict |
|---|---|---|---|
| §0.a Conflict census | conflicting live-value slots | `fact_slots=1138, multi_producer=19, multi_live_row=46, **conflicting_live_value=34**` | ✅ problem present |
| §0.b Provenance gap | `engine`/`producer` on every row | **all NULL** (1185 rows) | ✅ problem present |
| §0.c DSCR multi-formula | source_refs per fact_key | `DSCR` = 2 (`computed:noi/total_debt`, `computed:classic_spread:v2`); `DSCR_STRESSED_300BPS` = 3 (incl. `synthesis:golden_run:80fe6f7a`); `GLOBAL_CASH_FLOW`/`GCF_*` = 2 each; `ANNUAL_DEBT_SERVICE` multi | ✅ problem present |
| §0.d Conflict ledger | `count(*) deal_fact_conflicts` | **0 rows** | ✅ silent — detection never fired |
| §0.e Code paths | repo reads | `src/lib/spreads/` (V1) present; `computed:noi/total_debt` writer = `src/lib/structuralPricing/computeTotalDebtService.ts`; `classicSpread/classicSpreadRatios.ts` present; hardcoded `synthesis:golden_run:80fe6f7a` present (17 rows) | ✅ present |

### §0.e STALE-AUDIT finding (report, do not no-op)

The audit assumed `ebitdaEngine.ts` **still gates EBITDA on
`ORDINARY_BUSINESS_INCOME`** (C-corp/1120 bypass bug). It does **not** anymore —
`src/lib/financialIntelligence/ebitdaEngine.ts:66-98` already falls back to
`TAXABLE_INCOME` → `NET_INCOME` (+ tax add-back) for C-corps, fixed by
`SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 1`. **The C-corp EBITDA
root-cause is largely remediated.** This is a Phase 2 concern; flagged here so
Phase 2 re-verifies before implementing (it must not re-do a completed fix). All
Phase 0 targets remain present and valid.

---

## What Phase 0 ships (all additive)

- `src/lib/finengine/provenance.ts` — normalized `engine`/`version`/`method`/
  `source_quality_rank`; `source_ref`→engine map; §2.3 rank inference;
  `stampProvenance()`.
- `src/lib/financialFacts/writeFact.ts` — the **single write chokepoint**
  (`upsertDealFinancialFact`) now calls `stampProvenance()`. Every future fact
  write carries engine+version.
- `src/lib/finengine/conflictLedger.ts` — pure `detectSlotConflicts()` +
  deterministic `pickWinner()` (§2.3; golden-run can never win) +
  `buildConflictLedgerRows()` for `deal_fact_conflicts`.
- `src/lib/finengine/shadow/` — read-only §7 reconciliation harness scaffold
  (ZERO / INTENDED / UNEXPECTED classification; no cutover).
- `scripts/finengine-phase0-backfill.ts` — one-time backfill (dry-run default,
  `--execute`); snapshots golden-run before delete; reversible.
- `scripts/guards/guard-finengine-provenance-stamp.mjs` — **guard G2** (wired
  into `pnpm guard:all`): chokepoint must stamp; finengine must not bypass it.
- Unit tests under `src/lib/finengine/__tests__/` (27 tests, `node --test
  --import tsx`).

---

## Backfill dry-run evidence (computed against live corpus)

**[1] Provenance** — 1185/1185 rows missing `engine`; the backfill would stamp
every one (→ V0.2). Engine distribution to be written:

| engine | rows |
|---|---|
| extraction.docExtract | 1077 |
| finengine.spreads | 25 |
| hardcode | 23 |
| extraction.taxReturn | 19 |
| legacy.classicSpread | 16 |
| finengine.b4 | 12 |
| legacy.structuralPricing | 6 |
| legacy.noiPath | 4 |
| manual.loanRequest | 2 |
| legacy.stress | 1 |
| **unknown** | **0** (engine map extended after census) |

**[2] Conflicts** — 34 conflicting live-value slots detected (matches §0.a),
ledger would insert 34 rows and supersede the losers (→ V0.1, V0.3). By
fact_key: `TOTAL_INCOME` 12, `M1_BOOK_INCOME` 4, `M1_TAXABLE_INCOME` 4,
`SL_AR_GROSS` 4, `SL_CASH` 4, `TAXABLE_INCOME` 2, `F1125A_BEGIN_INVENTORY` 1,
`F1125A_DIRECT_LABOR` 1, `F1125A_PURCHASES` 1, `SL_RETAINED_EARNINGS` 1. (These
are extraction-value disagreements; cross-deal DSCR rows are single-valued per
slot and so do not conflict.)

**[3] Golden-run** — 23 hardcoded `synthesis:golden_run:*` /
`synthesis:canonical_alias:*` rows would be snapshotted then deleted (→ V0.4).
OmniCare DSCR becoming "unresolved/low" until Phase 2 fixes the real path is the
**expected, documented** outcome.

---

## V-checks

| V-check | Status |
|---|---|
| V0.1 conflicting live values → 0 (recorded/superseded) | ⏳ post-backfill (dry-run: 34 slots will resolve) |
| V0.2 every row has engine+version | ⏳ post-backfill (dry-run: 1185 rows, 0 unknown) |
| V0.3 `deal_fact_conflicts` ≥ 34 | ⏳ post-backfill (dry-run: 34) |
| V0.4 `synthesis:golden_run:%` → 0 rows | ⏳ post-backfill (dry-run: 23 deleted) |
| V0.5 `guard:all` green + typecheck | ✅ `guard:all` exit 0; `tsc --noEmit` 0 errors; 27 finengine tests pass |

The backfill mutates live data, so it runs **after this PR merges and deploys**
(so legacy producers don't re-introduce unstamped rows mid-flight):
`pnpm tsx --conditions=react-server scripts/finengine-phase0-backfill.ts --execute`
Then re-run §0.a–§0.d to confirm V0.1–V0.4.

---

## STOP

Per spec §0 rules 1–2: one phase per PR. **Phase 1 does not begin until this PR
is merged to `main` by the human and the backfill V-checks are confirmed
post-deploy.**
