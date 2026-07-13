/**
 * Phase 8 — Collateral Narrative Builder
 *
 * Builds the property_description / collateral narrative from canonical sources.
 * Source priority for AR LOC:
 *   1. ar_aging_reports + borrowing_base_calculations → AR narrative
 *   2. deal_collateral_items → item-based description
 *   3. deal_memo_overrides.collateral_description (legacy fallback only)
 *   4. Pending
 *
 * Pure function — no DB, no server-only. Safe for CI guards.
 */

export type ArBorrowingBaseInput = {
  as_of_date: string | null;
  total_ar: number | null;
  eligible_ar: number | null;
  ineligible_ar: number | null;
  advance_rate: number | null;
  borrowing_base_value: number | null;
  borrowing_base_availability: number | null;
};

export type CollateralItemInput = {
  description: string | null;
  address: string | null;
  collateral_type: string | null;
  estimated_value: number | null;
  market_value: number | null;
};

function fmt$(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}MM`;
  if (val >= 1_000) return `$${Math.round(val / 1_000)}K`;
  return `$${val.toFixed(0)}`;
}

/**
 * Builds a collateral narrative from itemized deal_collateral_items rows.
 * Returns null when there are no items with an actual description or value
 * (i.e. nothing worth naming — falls through to the next source).
 */
export function buildItemCollateralNarrative(
  items: CollateralItemInput[] | null | undefined,
): string | null {
  if (!items || items.length === 0) return null;

  const parts: string[] = [];
  for (const item of items) {
    const label = item.description?.trim() || item.collateral_type?.trim() || null;
    const value = item.market_value ?? item.estimated_value;
    if (!label && value === null) continue;
    const addr = item.address?.trim() ? ` (${item.address.trim()})` : "";
    if (label && value !== null) {
      parts.push(`${label}${addr} valued at ${fmt$(value)}`);
    } else if (label) {
      parts.push(`${label}${addr}`);
    } else if (value !== null) {
      parts.push(`collateral item${addr} valued at ${fmt$(value)}`);
    }
  }

  if (parts.length === 0) return null;
  return `The facility is secured by ${parts.join("; ")}.`;
}

/**
 * Builds a collateral narrative from AR borrowing base data.
 * Returns null if AR data is insufficient.
 */
export function buildArCollateralNarrative(
  arBb: ArBorrowingBaseInput | null,
  loanAmount: number | null,
): string | null {
  if (!arBb || arBb.total_ar === null) return null;

  const parts: string[] = [
    "The facility is secured by eligible accounts receivable under a borrowing base.",
  ];

  if (arBb.as_of_date) {
    parts.push(`As of ${arBb.as_of_date},`);
  }

  parts.push(`total AR was ${fmt$(arBb.total_ar)}`);

  if (arBb.eligible_ar !== null) {
    parts.push(`eligible AR was ${fmt$(arBb.eligible_ar)}`);
  }

  if (arBb.advance_rate !== null && arBb.borrowing_base_value !== null) {
    parts.push(
      `and the ${Math.round(arBb.advance_rate * 100)}% advance rate supports a borrowing base of ${fmt$(arBb.borrowing_base_value)}`
    );
  }

  if (arBb.borrowing_base_availability !== null && loanAmount !== null) {
    parts.push(
      `providing ${fmt$(arBb.borrowing_base_availability)} availability above the proposed ${fmt$(loanAmount)} LOC`
    );
  }

  return parts.join(", ").replace(/,\s*,/g, ",").replace(/\.\s*,/, ".") + ".";
}

/**
 * Returns the collateral property description, respecting source priority:
 *   1. AR borrowing base (AR LOC deals)
 *   2. Itemized deal_collateral_items
 *   3. Legacy deal_memo_overrides.collateral_description
 *   4. Pending
 */
export function resolveCollateralDescription(args: {
  arBorrowingBase: ArBorrowingBaseInput | null;
  loanAmount: number | null;
  legacyOverrideDescription: string | null;
  isArLocDeal: boolean;
  collateralItems?: CollateralItemInput[] | null;
}): { description: string; source: "ar_borrowing_base" | "collateral_items" | "legacy_override" | "pending" } {
  // For AR LOC deals, always prefer AR narrative
  if (args.isArLocDeal && args.arBorrowingBase) {
    const arNarrative = buildArCollateralNarrative(args.arBorrowingBase, args.loanAmount);
    if (arNarrative) {
      return { description: arNarrative, source: "ar_borrowing_base" };
    }
  }

  // Itemized collateral (banker-entered canonical store) takes priority over
  // the legacy narrative override — it must never disagree with the itemized
  // table/total values rendered elsewhere in the same memo.
  const itemNarrative = buildItemCollateralNarrative(args.collateralItems);
  if (itemNarrative) {
    return { description: itemNarrative, source: "collateral_items" };
  }

  // Non-AR or insufficient AR/item data: allow legacy fallback
  if (args.legacyOverrideDescription && args.legacyOverrideDescription.trim().length > 0) {
    return { description: args.legacyOverrideDescription, source: "legacy_override" };
  }

  return { description: "Pending", source: "pending" };
}
