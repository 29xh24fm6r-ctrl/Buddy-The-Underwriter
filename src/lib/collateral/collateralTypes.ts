/**
 * Canonical collateral types and their default advance rates.
 *
 * Pure module — no server-only, safe for CI guard imports.
 *
 * Three places assign a collateral type and all three agree on the same six
 * values: the document classifiers in prefillMemoInputs and
 * extractCollateralFromDocuments, and the banker-facing dropdown in
 * CollateralItemsTable. `DEFAULT_ADVANCE_RATES` in computePure was keyed by a
 * different vocabulary entirely — it had `blanket_lien` where the classifiers
 * emit `ucc_lien`, `other` where they emit `general`, and nothing at all for
 * `insurance_backed` or `purchase_target`.
 *
 * Four of the six therefore missed the table and silently took its `?? 0.50`
 * fallback. Production already holds a `ucc_lien` row with no explicit rate,
 * discounted at 50% where a blanket lien on business assets is 70% — and that
 * figure becomes COLLATERAL_NET_VALUE on the credit memo.
 *
 * Nothing surfaced it: no error, no warning, and the one test covering the
 * fallback passes `item_type: "equipment"`, a key that is in the table. It
 * proved the default works for the one case that never needed it.
 */

/** Every collateral type any producer in this system emits. */
export const COLLATERAL_TYPES = [
  // Emitted by the classifiers and offered in the banker dropdown.
  "real_estate",
  "equipment",
  "ucc_lien",
  "insurance_backed",
  "purchase_target",
  "general",
  // Legacy keys already present on deal_collateral_items rows.
  "accounts_receivable",
  "inventory",
  "blanket_lien",
  "vehicle",
  "other",
] as const;

export type CollateralType = (typeof COLLATERAL_TYPES)[number];

/**
 * Default advance rate by type, used only when the banker has not entered an
 * explicit `advance_rate` on the item.
 *
 * `null` means this system has no defensible default for the type and a rate
 * must come from the banker. That is deliberately different from a low
 * number: guessing a discount on a life-insurance assignment or on the going
 * concern being acquired would be inventing lending policy, which is exactly
 * the failure this module exists to remove.
 */
export const DEFAULT_ADVANCE_RATES: Record<CollateralType, number | null> = {
  real_estate: 0.80,
  equipment: 0.75,
  accounts_receivable: 0.80,
  inventory: 0.50,
  vehicle: 0.75,
  // A UCC filing over business assets is a blanket lien; same collateral,
  // different word. These two must never drift apart again.
  blanket_lien: 0.70,
  ucc_lien: 0.70,
  // Unclassified collateral, discounted conservatively.
  other: 0.50,
  general: 0.50,
  // No defensible default — the advance depends on cash surrender value and
  // on what is actually being bought.
  insurance_backed: null,
  purchase_target: null,
};

export type AdvanceRateResolution =
  | { status: "explicit"; rate: number }
  | { status: "default"; rate: number; itemType: CollateralType }
  | { status: "needs_banker_rate"; itemType: CollateralType }
  | { status: "unknown_type"; itemType: string };

/**
 * Resolve the advance rate for one collateral item.
 *
 * Never returns a silent fallback. An unrecognised type and a type with no
 * defensible default are each reported as such, so the caller can record a
 * data-quality gap instead of discounting the borrower's collateral by a
 * number nobody chose.
 */
export function resolveAdvanceRate(item: {
  item_type: string;
  advance_rate?: number | null;
}): AdvanceRateResolution {
  if (typeof item.advance_rate === "number" && Number.isFinite(item.advance_rate)) {
    return { status: "explicit", rate: item.advance_rate };
  }

  const itemType = item.item_type;
  if (!isCollateralType(itemType)) {
    return { status: "unknown_type", itemType };
  }

  const rate = DEFAULT_ADVANCE_RATES[itemType];
  if (rate === null) return { status: "needs_banker_rate", itemType };
  return { status: "default", rate, itemType };
}

export function isCollateralType(value: string): value is CollateralType {
  return (COLLATERAL_TYPES as readonly string[]).includes(value);
}
