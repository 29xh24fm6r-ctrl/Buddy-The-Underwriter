/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream D — sizing → pricing (additive/shadow).
 *
 * Pricing (structuralPricing) takes the banker-entered `loan_amount` as given and
 * derives rate/PMT/debt-service from it — it sizes independently of the engine.
 * finengine/sizing computes the MAX supportable loan with a binding constraint
 * (LTV / DSCR / debt-yield / borrowing-base). Pricing is BORROWER-FACING, so per
 * NG2 we do NOT change a live price: this reconciles the priced facility against
 * the engine-sized maximum and surfaces a shadow flag when pricing exceeds what
 * the engine supports. Read-only, pure — the pricing path can call this to log /
 * gate without altering the quoted price.
 */

import { sizeCre, sizeBorrowingBase, type SizingResult, type CreSizingInputs, type BorrowingBaseInputs } from "@/lib/finengine/sizing";

export type ShadowClass = "ZERO" | "INTENDED" | "UNEXPECTED";

export type SizingPricingShadow = {
  pricedLoanAmount: number;
  finengineMaxLoan: number | null;
  bindingConstraint: string | null;
  /** finengineMaxLoan − pricedLoanAmount (negative ⇒ priced ABOVE the engine-sized max). */
  headroom: number | null;
  withinSizing: boolean | null;
  classification: ShadowClass;
  note: string;
};

/**
 * Reconcile a priced loan amount against an engine SizingResult. ZERO when the
 * priced facility is within the engine-sized maximum (allowing a tolerance);
 * UNEXPECTED when it exceeds it (an over-sized facility — flag for review);
 * INTENDED when a registered exception explains the overage.
 */
export function reconcileSizingVsPricing(i: {
  pricedLoanAmount: number;
  sizing: SizingResult;
  tolerancePct?: number;
  intendedReason?: string;
}): SizingPricingShadow {
  const tol = i.tolerancePct ?? 0;
  const max = i.sizing.maxLoan;
  const binding = i.sizing.bindingConstraint?.name ?? null;

  if (max == null) {
    return {
      pricedLoanAmount: i.pricedLoanAmount,
      finengineMaxLoan: null,
      bindingConstraint: binding,
      headroom: null,
      withinSizing: null,
      classification: "ZERO",
      note: "Engine sizing indeterminate (insufficient inputs) — no shadow comparison.",
    };
  }

  const allowed = max * (1 + tol);
  const withinSizing = i.pricedLoanAmount <= allowed;
  const headroom = max - i.pricedLoanAmount;
  let classification: ShadowClass;
  let note: string;
  if (withinSizing) {
    classification = "ZERO";
    note = `Priced ${fmt(i.pricedLoanAmount)} within engine-sized max ${fmt(max)} (binding ${binding}); headroom ${fmt(headroom)}.`;
  } else if (i.intendedReason) {
    classification = "INTENDED";
    note = `Priced ${fmt(i.pricedLoanAmount)} exceeds engine-sized max ${fmt(max)} (binding ${binding}) — registered exception: ${i.intendedReason}.`;
  } else {
    classification = "UNEXPECTED";
    note = `Priced ${fmt(i.pricedLoanAmount)} EXCEEDS engine-sized max ${fmt(max)} by ${fmt(-headroom)} (binding ${binding}) — over-sized facility; review or register an exception.`;
  }

  return { pricedLoanAmount: i.pricedLoanAmount, finengineMaxLoan: max, bindingConstraint: binding, headroom, withinSizing, classification, note };
}

/** Convenience: size a CRE facility from the engine, then reconcile vs the priced amount. */
export function shadowCreSizingVsPricing(pricedLoanAmount: number, cre: CreSizingInputs, opts?: { tolerancePct?: number; intendedReason?: string }): SizingPricingShadow {
  return reconcileSizingVsPricing({ pricedLoanAmount, sizing: sizeCre(cre), ...opts });
}

/** Convenience: size an ABL borrowing base from the engine, then reconcile vs the priced amount. */
export function shadowBorrowingBaseVsPricing(pricedLoanAmount: number, bb: BorrowingBaseInputs, opts?: { tolerancePct?: number; intendedReason?: string }): SizingPricingShadow {
  return reconcileSizingVsPricing({ pricedLoanAmount, sizing: sizeBorrowingBase(bb), ...opts });
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
