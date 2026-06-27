# SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 6 retirement runbook

Phase 6 closes the program. It ships the **additive** closers (memo-from-objects,
covenant & monitoring engine, guard G4) and **documents** the destructive
retirement steps, which are deliberately **NOT executed in this PR**.

## Why the deletions are deferred (not skipped)

The spec's §7 safety protocol requires that **each legacy deletion be preceded by
a clean shadow-reconciliation proof for that consumer**, and that consumers be
flipped to the core (Phase 5 flags) **before** any producer is retired. That
proof requires Phases 0–5 **merged and deployed** and the shadow harness run
against live dev deals. None of that has happened yet (these are stacked,
un-merged PRs). Executing deletions now would change the live credit path before
any reconciliation — violating NG5 and §7 and risking borrower-facing breakage.

Therefore the retirement is a **post-deploy runbook**, gated on evidence.

## Preconditions (all must hold before ANY deletion)

1. PRs for Phases 0–5 merged to `main` and deployed (`readyState=READY`).
2. Phase 0 backfill executed; §0.a–§0.d V-checks confirmed (0 live conflicts,
   engine attribution present, golden-run gone).
3. Per product, the shadow diff (`finengine.core.shadow` vs legacy) is all
   ZERO/INTENDED — every divergence pre-registered in the golden-set.
4. That product's Phase 5 cutover flag flipped ON and stable.

## Retirement steps (each a SEPARATE commit, each gated)

| Step | Action | Gate |
|---|---|---|
| R1 | Route `classicSpreadRatios.ts` / `entityCashFlowFromSpread.ts` to read from the core (stop computing) | CI + classic-spread renderer unchanged (presentation only) |
| R2 | Retire `src/lib/spreads/` (V1) | no consumer references (grep guard) + shadow clean |
| R3 | Retire the `computed:noi/total_debt` writer (`computeTotalDebtService` NOI path) | DSCR single-writer (re-run §0.c) |
| R4 | Delete dead `financial_snapshot_facts`; collapse `financial_snapshots` vs `financial_snapshots_v2` to one (do NOT revive stalled v2 big-bang) | snapshot parity proof |
| R5 | Point credit-memo / brokerage / Omega advisory reads at the core | memo-from-objects guard (G4) green |

Each R-step reverts independently (revert that one commit) if its consumer
regresses.

## Guards activated this PR

- **G4** (`guard-finengine-memo-wall.mjs`, in `guard:all`): the memo/covenant
  layer never writes upward into facts/conclusions (§2.1 wall). Enforced now.
- **G3** (single writer per core metric): partially enforced now (no finengine
  module writes canonical facts — all pure). Full cross-repo enforcement
  (`DSCR`/`GLOBAL_CASH_FLOW`/`ANNUAL_DEBT_SERVICE`/`GCF_DSCR` written only by the
  core) activates once R1–R3 land — see step R3.

## Minor cleanup tracked here

- `[cfa-extract-5]` stale assertion (`classicSpread:debtService:v1` → `v2`):
  fix alongside R1 when the classic-spread path is rerouted, to avoid touching
  the legacy test before its producer is migrated.

## V-checks (post-retirement, run after R1–R5)

- **V6.1** zero remaining writers of `DSCR`/`GLOBAL_CASH_FLOW`/`ANNUAL_DEBT_SERVICE`
  except the core (re-run §0.c).
- **V6.2** `src/lib/spreads/` (V1) + `computed:noi/*` removed; no references.
- **V6.3** memo-from-objects guard (G4) green — already green this PR.
- **V6.4** full `test:unit` + `test:invariants` + `guard:all` green.
- **V6.5** re-run §0.a — 0 conflicting live values, 0 multi-producer slots for
  core metrics.
