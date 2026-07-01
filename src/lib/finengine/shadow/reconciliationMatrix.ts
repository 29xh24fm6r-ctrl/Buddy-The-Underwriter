/**
 * SPEC-FINENGINE-RECONCILIATION-MATRIX-1 §3+§4 — reconciliation matrix (pure).
 *
 * Folds the three finengine shadow harnesses' outputs across a resolved deal set into
 * a single ZERO/INTENDED/UNEXPECTED matrix — per deal, by product, by bank — with one
 * cutover-readiness verdict.
 *
 * "One engine, one gate" invariant (Addendum): this module ONLY orchestrates the
 * existing pure runners (`runFullSpreadShadow`, `runGlobalCashFlowShadow`,
 * `runDecisionCoreShadow`) and aggregates their existing `ShadowReport`s. It never
 * imports `computeDealSpread` / `computeGlobalCashFlow` / `stressEngine` directly and
 * never re-derives a value — classification stays in `compareProducers`. A source-grep
 * guard proves it. Pure; read-only (NG1): console/JSON only, no writes/flags/render.
 *
 * Gating rule (§3, R1): only the two GATED harnesses drive `cutoverReady` —
 * full-spread (EBITDA) + decision-core (DSCR / DSCR_STRESSED_300BPS). The global cash
 * flow assembler has NO legacy counterpart, so it contributes `globalDSCR` +
 * `singleCountVerified` as informational health signals, NEVER a gated diff. A broken
 * single-count wall (`singleCountVerified=false`) is a correctness failure → hard block
 * even at unexpected==0. A runner/load error forces a block, never a silent drop (R4).
 */

import { runFullSpreadShadow } from "@/lib/finengine/shadow/runFullSpreadShadow";
import { runGlobalCashFlowShadow } from "@/lib/finengine/shadow/globalCashFlowAdapter";
import { runDecisionCoreShadow } from "@/lib/finengine/shadow/runDecisionCoreShadow";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import type { ShadowReport } from "@/lib/finengine/shadow/reconcile";
import type { DealSetEntry } from "@/lib/finengine/shadow/reconciliationDealSet";

export type DealReconResult = {
  deal: DealSetEntry;
  analysisPeriod: string;
  fullSpread: ShadowReport; // EBITDA-gated
  decisionCore: ShadowReport; // DSCR + DSCR_STRESSED_300BPS-gated
  // global cash flow contributes globalDSCR + singleCountVerified (informational; not a legacy-gated diff)
  globalDSCR: number | null;
  singleCountVerified: boolean;
  warnings: string[];
  cutoverBlocked: boolean; // true if ANY gated harness has unexpected>0, single-count broke, or a runner errored
  /** Set when a runner/load threw for this deal — forces a block, surfaced in blockingDeals (R4). */
  error?: string | null;
};

export type ProductRollup = { deals: number; zero: number; intended: number; unexpected: number; cutoverBlocked: boolean };
export type BankRollup = { deals: number; unexpected: number; cutoverBlocked: boolean };

export type BlockingDeal = { dealId: string; harness: string; unexpectedKeys: string[] };

export type ReconciliationMatrix = {
  generatedAt: string;
  dealsRun: number;
  byDeal: DealReconResult[];
  byProduct: Record<string, ProductRollup>;
  byBank: Record<string, BankRollup>;
  verdict: {
    cutoverReady: boolean; // ALL deals: unexpected==0 across full-spread + decision-core, single-count intact, no error
    productsPresent: string[]; // from the data — NOT an assumed 8-product list
    banksPresent: string[];
    blockingDeals: BlockingDeal[];
  };
};

const BANK_UNKNOWN = "UNKNOWN";

/** An empty gated report — used to represent a harness that could not run (errored deal). */
function emptyReport(): ShadowReport {
  return { total: 0, zero: 0, intended: 0, unexpected: 0, cutoverBlocked: false, divergences: [] };
}

/** UNEXPECTED fact keys in a gated report (the offending keys for `blockingDeals`). */
function unexpectedKeys(report: ShadowReport): string[] {
  return report.divergences.filter((d) => d.classification === "UNEXPECTED").map((d) => d.factKey);
}

/** Whether a single deal blocks cutover (gated harnesses + single-count wall + errors). */
function dealBlocked(r: DealReconResult): boolean {
  return (
    r.error != null ||
    r.fullSpread.unexpected > 0 ||
    r.decisionCore.unexpected > 0 ||
    !r.singleCountVerified
  );
}

/**
 * Run the three shadow harnesses for ONE deal and assemble its `DealReconResult`.
 * A throw anywhere (load-shaped rows, a runner error) is caught and recorded as
 * `error` with a forced block — never swallowed into a false pass (R4). Pure over
 * the injected rows.
 */
export function runDealRecon(deal: DealSetEntry, rows: CertifiedFactRow[]): DealReconResult {
  try {
    const full = runFullSpreadShadow(deal.dealId, rows);
    const decision = runDecisionCoreShadow(deal.dealId, rows);
    const global = runGlobalCashFlowShadow(deal.dealId, rows);

    const result: DealReconResult = {
      deal,
      analysisPeriod: decision.analysisPeriod,
      fullSpread: full.report,
      decisionCore: decision.report,
      globalDSCR: global.result.globalDSCR,
      singleCountVerified: global.result.singleCountVerified,
      warnings: [...decision.warnings],
      cutoverBlocked: false,
      error: null,
    };
    result.cutoverBlocked = dealBlocked(result);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      deal,
      analysisPeriod: "—",
      fullSpread: emptyReport(),
      decisionCore: emptyReport(),
      globalDSCR: null,
      singleCountVerified: false,
      warnings: [`runner error: ${message}`],
      cutoverBlocked: true,
      error: message,
    };
  }
}

/**
 * PURE aggregator: fold per-deal results into the matrix + verdict. No I/O.
 * `generatedAt` is injected (the script stamps a real timestamp; tests omit it so the
 * fold stays deterministic).
 */
export function buildReconciliationMatrix(
  results: DealReconResult[],
  opts?: { generatedAt?: string },
): ReconciliationMatrix {
  const byProduct: Record<string, ProductRollup> = {};
  const byBank: Record<string, BankRollup> = {};
  const blockingDeals: BlockingDeal[] = [];

  for (const r of results) {
    const blocked = dealBlocked(r);

    // Product rollup — sum the two GATED reports' classification counts.
    const p = (byProduct[r.deal.dealType] ??= { deals: 0, zero: 0, intended: 0, unexpected: 0, cutoverBlocked: false });
    p.deals += 1;
    p.zero += r.fullSpread.zero + r.decisionCore.zero;
    p.intended += r.fullSpread.intended + r.decisionCore.intended;
    p.unexpected += r.fullSpread.unexpected + r.decisionCore.unexpected;
    p.cutoverBlocked = p.cutoverBlocked || blocked;

    // Bank rollup.
    const bankKey = r.deal.bankId ?? BANK_UNKNOWN;
    const b = (byBank[bankKey] ??= { deals: 0, unexpected: 0, cutoverBlocked: false });
    b.deals += 1;
    b.unexpected += r.fullSpread.unexpected + r.decisionCore.unexpected;
    b.cutoverBlocked = b.cutoverBlocked || blocked;

    // Blocking reasons — one entry per (deal, harness) that blocks.
    if (r.error != null) {
      blockingDeals.push({ dealId: r.deal.dealId, harness: "runner", unexpectedKeys: [r.error] });
    }
    if (r.fullSpread.unexpected > 0) {
      blockingDeals.push({ dealId: r.deal.dealId, harness: "full-spread", unexpectedKeys: unexpectedKeys(r.fullSpread) });
    }
    if (r.decisionCore.unexpected > 0) {
      blockingDeals.push({ dealId: r.deal.dealId, harness: "decision-core", unexpectedKeys: unexpectedKeys(r.decisionCore) });
    }
    if (!r.singleCountVerified && r.error == null) {
      // Hard block distinct from a divergence: the single-count wall itself broke.
      blockingDeals.push({ dealId: r.deal.dealId, harness: "global-cash-flow", unexpectedKeys: ["singleCountVerified=false"] });
    }
  }

  const productsPresent = [...new Set(results.map((r) => r.deal.dealType))].sort();
  const banksPresent = [...new Set(results.map((r) => r.deal.bankId ?? BANK_UNKNOWN))].sort();
  const cutoverReady = results.length > 0 && results.every((r) => !dealBlocked(r));

  return {
    generatedAt: opts?.generatedAt ?? "",
    dealsRun: results.length,
    byDeal: results,
    byProduct,
    byBank,
    verdict: { cutoverReady, productsPresent, banksPresent, blockingDeals },
  };
}

/**
 * Orchestration entrypoint (PURE — rows injected). For each resolved deal, run the
 * three harnesses and fold into the matrix. The SCRIPT supplies `rowsByDeal` (its DB
 * read) and the timestamp.
 */
export function runReconciliationMatrix(
  deals: DealSetEntry[],
  rowsByDeal: Record<string, CertifiedFactRow[]>,
  opts?: { generatedAt?: string },
): ReconciliationMatrix {
  const results = deals.map((deal) => runDealRecon(deal, rowsByDeal[deal.dealId] ?? []));
  return buildReconciliationMatrix(results, opts);
}
