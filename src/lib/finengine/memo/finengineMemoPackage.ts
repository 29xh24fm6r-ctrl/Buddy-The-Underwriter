/**
 * SPEC-FINENGINE god-tier improvement D — memo assembly + cutover gate.
 *
 * The production-ready assembly that turns a deal's certified facts into a
 * finengine-backed credit memo: compute the spread, validate it against the
 * independent golden, feed the metrics + spread section into buildCreditMemo,
 * and attach the CUTOVER GATE. A memo whose spread carries an UNEXPECTED
 * divergence (engine ≠ independent golden) is gated: `gate.allowed === false`.
 *
 * This is pure and additive — it ASSEMBLES the objects the live memo/borrower-
 * report route will consume; it does not itself replace the legacy renderer.
 * Flipping the route to call this (and enforcing the gate at submission) is the
 * deliberate, separate cutover step. Honors the G4 memo wall (no number is
 * computed here that the engine didn't already certify).
 */

import { computeDealSpread, type DealSpread } from "@/lib/finengine/spread/dealSpread";
import { validateSpread, type SpreadValidation, type IntendedDivergence } from "@/lib/finengine/spread/validateSpread";
import { spreadToMemoContribution } from "@/lib/finengine/spread/spreadMemo";
import { buildCreditMemo, type MemoInputs, type MemoSection } from "@/lib/finengine/memo/buildCreditMemo";
import type { CertifiedFactRow, EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";

export type CutoverGate = {
  allowed: boolean; // false ⇒ memo may not finalize until resolved or overridden
  blocked: boolean;
  unexpected: number;
  reason: string;
};

/** The cutover gate: a memo may not finalize while the spread diverges from the independent golden. */
export function memoGate(validation: SpreadValidation): CutoverGate {
  const blocked = validation.cutoverBlocked;
  return {
    allowed: !blocked,
    blocked,
    unexpected: validation.unexpected,
    reason: blocked
      ? `${validation.unexpected} UNEXPECTED divergence(s) vs the independent golden — analyst review or a registered exception is required before this memo can finalize.`
      : "Spread agrees with the independent golden — cleared for finalization.",
  };
}

/** Hard enforcement for a submission path: throws when the spread is cutover-blocked. */
export function assertCutoverClean(validation: SpreadValidation): void {
  if (validation.cutoverBlocked) {
    throw new Error(`[finengine] memo blocked: ${memoGate(validation).reason}`);
  }
}

export type FinengineMemoPackage = {
  spread: DealSpread;
  validation: SpreadValidation;
  gate: CutoverGate;
  memo: { sections: MemoSection[]; marketplaceRedacted: boolean };
};

/**
 * Assemble the finengine-backed memo for a deal. Pure: the live route loads the
 * certified rows + the non-financial MemoInputs (borrower, request, sources/uses,
 * guarantors, …) and passes them here. The financial metrics + credit-spread
 * section come from the engine; everything else passes through untouched.
 */
export function buildFinengineMemoPackage(
  dealId: string,
  rows: CertifiedFactRow[],
  base: MemoInputs,
  opts?: { scope?: EntityScope; intended?: IntendedDivergence[] },
): FinengineMemoPackage {
  const scope = opts?.scope ?? "BUSINESS";
  const spread = computeDealSpread(dealId, rows);
  const validation = validateSpread(spread, { scope, intended: opts?.intended });
  const gate = memoGate(validation);

  const { metrics, section } = spreadToMemoContribution(spread, {
    scope,
    validation: { unexpected: validation.unexpected, cutoverBlocked: validation.cutoverBlocked },
  });

  // Engine metrics augment (never overwrite) any caller-supplied metrics.
  const merged: MemoInputs = { ...base, metrics: [...(base.metrics ?? []), ...metrics] };
  const built = buildCreditMemo(merged);

  // The credit-spread section is appended after the rendered memo sections.
  return {
    spread,
    validation,
    gate,
    memo: { sections: [...built.sections, section], marketplaceRedacted: built.marketplaceRedacted },
  };
}
