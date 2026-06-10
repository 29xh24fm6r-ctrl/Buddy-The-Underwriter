/**
 * SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 2 (PR-518) —
 * entity/form-aware owner-compensation normalization.
 *
 * Buddy previously distinguished only "FORM_1065 vs FORM_1120" (by the presence of
 * GUARANTEED_PAYMENTS), conflating C-corp / S-corp / sole-prop and adding back 100%
 * of officer compensation in the crude C-corp NCADS fallback. This module classifies
 * the tax form from extracted fact signatures and produces a form-correct owner-comp
 * treatment that NEVER adds back 100% by default:
 *
 *   • C-corp (1120):        normalize officer comp vs replacement (excess only)
 *   • S-corp (1120S):       W-2 wages normalized vs replacement (excess only); K-1
 *                           residual flows to PERSONAL income (not double-counted)
 *   • Partnership (1065):   guaranteed payments normalized vs replacement (excess)
 *   • Sole prop (Sch C):    NO add-back — net profit already IS the owner's return
 *   • LLC:                  has no own tax form — it files as one of the above, so the
 *                           fact signature (GP / OBI / Sch C net profit) drives it.
 *
 * Pure — no DB, no server-only. Delegates the excess-over-market computation to the
 * existing analyzeOfficerComp engine.
 */

import type { MethodologySlate } from "@/lib/methodology/types";
import { analyzeOfficerComp } from "./officerCompEngine";

export type EntityTaxForm = "C_CORP" | "S_CORP" | "PARTNERSHIP" | "SOLE_PROP" | "UNKNOWN";

type FactMap = Record<string, number | null>;

const present = (facts: FactMap, key: string): boolean => {
  const v = facts[key];
  return v !== undefined && v !== null;
};

/**
 * Classify the filing form from extracted fact signatures (deterministic). An LLC is
 * classified by how it files (its facts), not as a separate form.
 *   Schedule C net profit         → SOLE_PROP (incl. single-member / disregarded LLC)
 *   guaranteed payments           → PARTNERSHIP (incl. LLC-as-partnership)
 *   ordinary business income      → S_CORP (1120S has OBI; incl. LLC-as-S-corp)
 *   taxable income (no OBI/GP)    → C_CORP (1120)
 */
export function classifyEntityTaxForm(facts: FactMap): EntityTaxForm {
  if (present(facts, "SCH_C_NET_PROFIT") || present(facts, "SCHEDULE_C_NET_PROFIT")) return "SOLE_PROP";
  if (present(facts, "GUARANTEED_PAYMENTS")) return "PARTNERSHIP";
  if (present(facts, "ORDINARY_BUSINESS_INCOME")) return "S_CORP";
  if (present(facts, "TAXABLE_INCOME")) return "C_CORP";
  return "UNKNOWN";
}

/** The engine's coarse form string (it only special-cases FORM_1065 for the GP proxy). */
export function toEngineFormType(form: EntityTaxForm): string {
  return form === "PARTNERSHIP" ? "FORM_1065" : "FORM_1120";
}

export type OwnerCompTreatment = {
  form: EntityTaxForm;
  /** Add-back applied to EBITDA/NCADS — EXCESS over replacement only, never 100%. */
  addback: number;
  basis: string;
  note: string;
};

/**
 * Form-correct owner-compensation add-back. Returns the EXCESS over replacement
 * compensation (never the full amount) and a provenance note explaining the
 * entity-specific treatment.
 */
export function ownerCompTreatment(
  facts: FactMap,
  form: EntityTaxForm,
  slate?: MethodologySlate,
): OwnerCompTreatment {
  if (form === "SOLE_PROP") {
    return {
      form,
      addback: 0,
      basis: "schedule_c_net_profit_is_owner_return",
      note: "Sole proprietor (Schedule C): net profit already includes the owner's return — no owner-compensation add-back (it is not payroll).",
    };
  }
  if (form === "UNKNOWN") {
    return {
      form,
      addback: 0,
      basis: "form_unknown_conservative",
      note: "Entity tax form could not be determined from the facts — no owner-compensation add-back applied (conservative).",
    };
  }

  // C_CORP / S_CORP / PARTNERSHIP → normalize against replacement (excess only).
  const a = analyzeOfficerComp(facts, toEngineFormType(form), slate);
  const addback = a.adjustedEbitdaImpact && a.adjustedEbitdaImpact > 0 ? a.adjustedEbitdaImpact : 0;

  const compLabel =
    form === "PARTNERSHIP" ? "guaranteed payments" : form === "S_CORP" ? "owner W-2 wages" : "officer compensation";
  let note: string;
  if (a.flag === "EXTREME_HIGH") {
    note =
      `${form === "PARTNERSHIP" ? "Partnership" : form === "S_CORP" ? "S-corp" : "C-corp"} ${compLabel} normalized against replacement compensation — ` +
      `only the excess over market rate (${addback > 0 ? "$" + Math.round(addback).toLocaleString("en-US") : "$0"}) is added back, not the full amount.`;
  } else {
    note =
      `${form === "PARTNERSHIP" ? "Partnership" : form === "S_CORP" ? "S-corp" : "C-corp"} ${compLabel} is within market range — no add-back.`;
  }
  if (form === "S_CORP") {
    note += " S-corp K-1 residual income flows to personal cash flow and is not double-counted at the entity level.";
  }

  return { form, addback, basis: `replacement_compensation:${a.flag}`, note };
}
