/**
 * SPEC-B4 — Conservative Methodology Layer types.
 *
 * Pure types — no runtime, no DB, no side effects.
 */

export type MethodologyAxisId =
  | "ncads_source"
  | "ebitda_addback_stack"
  | "officer_comp"
  | "affiliate_ownership"
  | "living_expense";

export type MethodologyVariantId = string;

export type MethodologyAxis = {
  id: MethodologyAxisId;
  label: string;
  description: string;
  variants: MethodologyVariant[];
  defaultVariant: MethodologyVariantId;
  affectedFactKeys: string[];
};

export type MethodologyVariant = {
  id: MethodologyVariantId;
  label: string;
  description: string;
  rationale: string;
  conservatismRank: number; // 0 = most aggressive, 100 = most conservative
};

export type MethodologySlate = {
  ncads_source: MethodologyVariantId;
  ebitda_addback_stack: MethodologyVariantId;
  officer_comp: MethodologyVariantId;
  affiliate_ownership: MethodologyVariantId;
  living_expense: MethodologyVariantId;
};

export type MethodologyChoice = {
  axis: MethodologyAxisId;
  variant: MethodologyVariantId;
  chosenAt: string;
  chosenBy: string | null;
  reason: string | null;
};

export type MethodologyProvenance = {
  axis: MethodologyAxisId;
  chosen_variant: MethodologyVariantId;
  alternatives_considered: MethodologyVariantId[];
  rationale: string;
  slate_hash: string;
  is_default: boolean;
};
