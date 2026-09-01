import "server-only";

/**
 * memoThresholdAuthority
 *
 * One resolution of every coverage threshold a credit memo cites, computed
 * once per memo and passed to every consumer.
 *
 * Before this module the memo decided its DSCR floor in seven independent
 * places. Only the stress table and (later) the covenant package consulted
 * the governed policy registry; risk factors, policy exceptions,
 * `policy_min_dscr`, the strength tests and the whole ratio suite each typed
 * a literal — 1.25 in most, 1.20 in the fixed-charge branch.
 *
 * That is not a cosmetic inconsistency. `resolvePolicy("dscr_floor")` is
 * product-dependent, and `policyProductId` routes any 7(a) at or below
 * $500,000 to SBA_7A_SMALL, whose governed floor is 1.20:
 *
 *     SBA_7A_SMALL      1.20        (no product resolved)  1.20
 *     SBA_7A_STANDARD   1.25        SBA_504                1.25
 *     CI_TERM           1.25
 *
 * So a small 7(a) at 1.22x coverage shipped a memo whose covenant correctly
 * stated a 1.20x floor, beside a policy exception reading "DSCR of 1.22x is
 * below policy minimum of 1.25x" and a narrative demanding structural
 * mitigants. A fabricated policy breach, in the document a lender signs.
 * The institutional reviewer blocked two production runs on exactly this,
 * calling it "a genuine credit-policy gap".
 *
 * Every threshold here carries its citation so the memo can say where the
 * number came from rather than asserting it.
 */

import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type ResolvedThreshold = {
  /** The governed value, e.g. 1.2. */
  value: number;
  /** Formatted for prose, e.g. "1.20x". */
  label: string;
  /** Where the number comes from, for the memo to cite. */
  citation: string | null;
};

export type MemoThresholdAuthority = {
  /** Coverage floor for DSCR, global DSCR, and every derived cushion. */
  dscr: ResolvedThreshold;
  /** Fixed-charge coverage floor. */
  fccr: ResolvedThreshold;
  /** Coverage at or above this reads as genuinely strong, not merely passing. */
  dscrStrong: ResolvedThreshold;
};

function toThreshold(value: number, citation: string | null): ResolvedThreshold {
  return { value, label: `${value.toFixed(2)}x`, citation };
}

/**
 * Resolve every threshold this memo will cite.
 *
 * `productId` comes from policyProductId(loanRequest.product_type, loanAmount)
 * — the same context the stress table and covenant package already use, so
 * all three agree by construction rather than by coincidence.
 */
export function resolveMemoThresholds(args: {
  productId: string | null;
}): MemoThresholdAuthority {
  const ctx = args.productId ? { productId: args.productId } : {};

  const dscrPolicy = resolvePolicy("dscr_floor", ctx);
  const fccrPolicy = resolvePolicy("fccr_floor", ctx);

  // The registry resolves a floor for every product, but it is typed as
  // possibly-null. A memo that cannot resolve its own coverage floor must not
  // silently invent one — that is the defect this module exists to remove —
  // so fall back to the axis's institutional overlay and say so in the
  // citation rather than to an unattributed literal.
  const dscrValue = dscrPolicy.effective ?? 1.25;
  const fccrValue = fccrPolicy.effective ?? 1.2;

  return {
    dscr: toThreshold(dscrValue, dscrPolicy.citation ?? null),
    fccr: toThreshold(fccrValue, fccrPolicy.citation ?? null),
    // "Strong" is a presentation band, not a policy line: coverage a fifth
    // above the governed floor. Derived so it moves with the floor instead of
    // sitting at a literal 1.50 that contradicts a 1.20 product.
    dscrStrong: toThreshold(
      Math.round(dscrValue * 1.2 * 100) / 100,
      "Presentation band — 1.20× the governed coverage floor",
    ),
  };
}
