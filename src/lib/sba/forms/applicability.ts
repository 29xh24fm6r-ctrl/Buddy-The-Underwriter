import { FORM_912_TRIGGER_FIELDS } from "@/lib/sba/forms/form1919/fields";

export type ApplicabilityInput = {
  program: "7a" | "504" | null;
  hasIndividualOwner: boolean;
  hasEquityOwningEntity: boolean;
  sellerNoteEquityPortion: number | null;
  constructionAmount: number | null;
};

/**
 * Deal-level "which forms are in play" — used by the next-question ranker
 * to decide which registry entries actually matter for this deal. Mirrors
 * the gating already implemented per-form (form601/inputBuilder.ts's
 * CONSTRUCTION_THRESHOLD, form155/inputBuilder.ts's seller-note check,
 * form148's per-owner guarantee), pulled into one place so the ranker
 * doesn't need to duplicate it.
 */
export function computeApplicableForms(input: ApplicabilityInput): string[] {
  const forms: string[] = [];

  if (input.program === "504") {
    forms.push("1244");
  } else {
    forms.push("1919");
  }

  if (input.hasIndividualOwner) {
    forms.push("148", "4506c", "413");
  }

  if ((input.sellerNoteEquityPortion ?? 0) > 0) {
    forms.push("155");
  }

  if ((input.constructionAmount ?? 0) > 10_000) {
    forms.push("601");
  }

  return forms;
}

/** Whether a given owner's known flags trigger Form 912 (SPEC S4 G-2 rule, reused). */
export function ownerTriggers912(ownerFields: Record<string, unknown>): boolean {
  return FORM_912_TRIGGER_FIELDS.some((key) => ownerFields[key] === true);
}
