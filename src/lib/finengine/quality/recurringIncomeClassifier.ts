/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 4: Earnings Quality Engine.
 *
 * Classifies an income-statement line / proposed EBITDA add-back by its
 * category and whether it is RECURRING or NONRECURRING. Pure, keyword-driven,
 * deterministic. No IO. This is the vocabulary the earnings-quality aggregator
 * uses to decide what belongs in sustainable (recurring) earnings.
 */

export type RecurrenceClass = "RECURRING" | "NONRECURRING" | "UNCERTAIN";

export type AdjustmentCategory =
  | "OWNER_COMP_NORMALIZATION"
  | "RELATED_PARTY_RENT"
  | "NONRECURRING_GAIN"
  | "NONRECURRING_LOSS"
  | "ASSET_SALE"
  | "INSURANCE_PROCEEDS"
  | "GOVERNMENT_SUPPORT" // PPP / ERC / EIDL forgiveness / grants
  | "LEGAL_SETTLEMENT"
  | "DEPRECIATION"
  | "AMORTIZATION"
  | "INTEREST"
  | "OTHER";

export type AdjustmentClassification = {
  category: AdjustmentCategory;
  recurrence: RecurrenceClass;
  /** True when the item is normally ADDED BACK to earnings (vs subtracted out). */
  typicalDirection: "ADD" | "SUBTRACT" | "EITHER";
};

const CATEGORY_RECURRENCE: Record<AdjustmentCategory, RecurrenceClass> = {
  OWNER_COMP_NORMALIZATION: "RECURRING", // the normalization is a standing adjustment
  RELATED_PARTY_RENT: "RECURRING",
  NONRECURRING_GAIN: "NONRECURRING",
  NONRECURRING_LOSS: "NONRECURRING",
  ASSET_SALE: "NONRECURRING",
  INSURANCE_PROCEEDS: "NONRECURRING",
  GOVERNMENT_SUPPORT: "NONRECURRING",
  LEGAL_SETTLEMENT: "NONRECURRING",
  DEPRECIATION: "RECURRING",
  AMORTIZATION: "RECURRING",
  INTEREST: "RECURRING",
  OTHER: "UNCERTAIN",
};

const CATEGORY_DIRECTION: Record<AdjustmentCategory, "ADD" | "SUBTRACT" | "EITHER"> = {
  OWNER_COMP_NORMALIZATION: "ADD",
  RELATED_PARTY_RENT: "EITHER",
  NONRECURRING_GAIN: "SUBTRACT", // remove one-time gain from earnings
  NONRECURRING_LOSS: "ADD", // add back one-time loss
  ASSET_SALE: "SUBTRACT",
  INSURANCE_PROCEEDS: "SUBTRACT",
  GOVERNMENT_SUPPORT: "SUBTRACT",
  LEGAL_SETTLEMENT: "ADD",
  DEPRECIATION: "ADD",
  AMORTIZATION: "ADD",
  INTEREST: "ADD",
  OTHER: "EITHER",
};

function has(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

/** Classify a labelled adjustment. Order = most-specific tokens first. */
export function classifyAdjustmentCategory(label: string): AdjustmentCategory {
  const s = label.toLowerCase();

  // Government support first — "ppp"/"erc" are highly specific.
  if (has(s, ["ppp", "paycheck protection", "erc", "employee retention", "eidl", "cares act", "government grant", "stimulus"]))
    return "GOVERNMENT_SUPPORT";
  if (has(s, ["insurance proceeds", "insurance recovery", "insurance settlement"])) return "INSURANCE_PROCEEDS";
  if (has(s, ["legal settlement", "lawsuit", "litigation", "settlement expense", "legal judgment"]))
    return "LEGAL_SETTLEMENT";
  if (has(s, ["gain on sale", "gain on disposal", "sale of asset", "asset sale", "disposal of"])) return "ASSET_SALE";
  if (has(s, ["related party rent", "related-party rent", "affiliate rent", "above-market rent", "below-market rent"]))
    return "RELATED_PARTY_RENT";
  if (has(s, ["officer comp", "owner comp", "owner's comp", "officer's comp", "excess compensation", "owner salary", "shareholder salary"]))
    return "OWNER_COMP_NORMALIZATION";
  if (has(s, ["nonrecurring gain", "non-recurring gain", "one-time gain", "unusual gain"])) return "NONRECURRING_GAIN";
  if (has(s, ["nonrecurring loss", "non-recurring loss", "one-time loss", "unusual loss", "write-off", "impairment", "writeoff"]))
    return "NONRECURRING_LOSS";
  if (has(s, ["depreciation"])) return "DEPRECIATION";
  if (has(s, ["amortization"])) return "AMORTIZATION";
  if (has(s, ["interest expense", "interest"])) return "INTEREST";
  return "OTHER";
}

export function classifyAdjustment(label: string): AdjustmentClassification {
  const category = classifyAdjustmentCategory(label);
  return {
    category,
    recurrence: CATEGORY_RECURRENCE[category],
    typicalDirection: CATEGORY_DIRECTION[category],
  };
}

export function isNonRecurring(label: string): boolean {
  return classifyAdjustment(label).recurrence === "NONRECURRING";
}
