/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 25: First Safe Product Cutover Candidate.
 *
 * The lowest-risk cutover: C&I term-loan DEBT SERVICE / DSCR only. Composes the
 * cutover seam (PR 20), the product cutover flags (PR 21), and a self-checking
 * reconciliation gate so the finengine path is used ONLY when its DSCR matches
 * legacy (or an intended divergence is registered). PRODUCTION DEFAULT IS LEGACY.
 *
 * Pure — legacy and finengine DSCR are injected. A single rollback call reverts
 * to legacy instantly.
 */

import {
  DEFAULT_PRODUCT_CUTOVER,
  resolveProductCutover,
  type ProductCutoverFlagMap,
} from "@/lib/finengine/cutover/productCutoverFlags";
import { runProducer, DEFAULT_PRODUCER_FLAGS } from "@/lib/finengine/cutover/legacyProducerAdapters";

export type CiTermDscrInputs = {
  legacyDscr: () => number | null;
  finengineDscr: () => number | null;
  flags?: ProductCutoverFlagMap;
  /** DSCR relative tolerance for the reconciliation self-check. */
  rtol?: number;
  /** Registered intended divergence — allows cutover despite a value gap. */
  intendedDivergence?: boolean;
};

export type CiTermDscrDecision = {
  path: "legacy" | "finengine";
  value: number | null;
  /** The reconciliation self-check verdict. */
  reconciliation: { clean: boolean; relDiff: number | null; reason: string };
  cutoverReason: string;
};

function relDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b)) || 1;
  return Math.abs(a - b) / denom;
}

/**
 * Decide + compute the C&I-term DSCR. The finengine path is used only when its
 * flag is on AND the shadow reconciliation is clean (DSCR match or intended
 * divergence). Any unresolved gap fails safe to legacy.
 */
export function cutoverCiTermDscr(inputs: CiTermDscrInputs): CiTermDscrDecision {
  const flags = inputs.flags ?? DEFAULT_PRODUCT_CUTOVER;
  const rtol = inputs.rtol ?? 1e-3;

  // Self-check reconciliation: compare legacy vs finengine DSCR.
  const legacyVal = inputs.legacyDscr();
  const finVal = inputs.finengineDscr();
  let clean: boolean;
  let rd: number | null = null;
  let reason: string;
  if (legacyVal == null || finVal == null) {
    clean = false;
    reason = "missing_value_one_side";
  } else {
    rd = relDiff(legacyVal, finVal);
    if (rd <= rtol) {
      clean = true;
      reason = "dscr_match";
    } else if (inputs.intendedDivergence) {
      clean = true;
      reason = "intended_divergence_registered";
    } else {
      clean = false;
      reason = "unresolved_dscr_divergence";
    }
  }

  const decision = resolveProductCutover("CI_TERM", flags, { cutoverBlocked: !clean });
  const chosen = runProducer(
    "computeTotalDebtService",
    { legacy: () => legacyVal, finengine: () => finVal },
    { ...DEFAULT_PRODUCER_FLAGS, computeTotalDebtService: decision.path === "finengine" },
  );

  return {
    path: decision.path,
    value: chosen.value,
    reconciliation: { clean, relDiff: rd, reason },
    cutoverReason: decision.reason,
  };
}

/** Rollback: the default (all-false) flag map — reverts C&I to legacy instantly. */
export function rollbackCiTermDscr(): ProductCutoverFlagMap {
  return { ...DEFAULT_PRODUCT_CUTOVER };
}

/** Production default: C&I DSCR stays on the legacy path. */
export const PRODUCTION_CI_TERM_DSCR_FLAGS: ProductCutoverFlagMap = { ...DEFAULT_PRODUCT_CUTOVER };
