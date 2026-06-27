/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2 shared method foundation.
 *
 * Reuses the EXISTING pure engines (NG2/NG3 — wire, do not reimplement):
 *   - computeEbitda           (entity-form-aware base + interest + D&A)
 *   - classifyEntityTaxForm   (C-corp / S-corp / partnership / sole-prop)
 *   - ownerCompTreatment      (excess-over-replacement, never 100%)
 *
 * Adds only the genuinely-new canon: §179 acceleration-only treatment.
 * Pure — no DB, no server-only imports (all dependencies are pure modules).
 */

import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";
import {
  classifyEntityTaxForm,
  toEngineFormType,
  type EntityTaxForm,
} from "@/lib/financialIntelligence/entityTaxForm";
import { analyzeOfficerComp } from "@/lib/financialIntelligence/officerCompEngine";
import type { SpreadInputs, EntityForm } from "@/lib/finengine/contracts";

const num = (v: number | null | undefined): number | null => (v == null ? null : v);

/** Map the engine's EntityTaxForm onto the contract's EntityForm. */
export function toContractForm(f: EntityTaxForm): EntityForm {
  switch (f) {
    case "C_CORP": return "C_CORP";
    case "S_CORP": return "S_CORP";
    case "PARTNERSHIP": return "PARTNERSHIP";
    case "SOLE_PROP": return "SOLE_PROP";
    default: return "UNKNOWN";
  }
}

/** Resolve the entity tax form, preferring an explicit input over inference. */
export function resolveForm(inputs: SpreadInputs): EntityTaxForm {
  if (inputs.entityForm && inputs.entityForm !== "UNKNOWN" && inputs.entityForm !== "INDIVIDUAL") {
    return inputs.entityForm as EntityTaxForm;
  }
  return classifyEntityTaxForm(inputs.facts);
}

export type CoreEarnings = {
  /** base income + interest + depreciation + amortization (conservative; NO §179, NO normalization). */
  value: number | null;
  base: { key: string; label: string; value: number | null };
  interest: number;
  depAmort: number;
  /** guaranteed-payments add-back the conservative engine included (1065) — tracked so
   *  owner-comp normalization does not double-count it. */
  gpIncluded: number;
};

/**
 * Core operating earnings via the conservative EBITDA slate: base (form-aware)
 * + interest + D&A only. We subtract any guaranteed-payments add-back so that
 * owner-comp normalization (excess-over-replacement) can be layered cleanly.
 */
export function coreOperatingEarnings(inputs: SpreadInputs): CoreEarnings {
  const form = resolveForm(inputs);
  const engineForm = inputs.formType ?? toEngineFormType(form);
  const e = computeEbitda(inputs.facts, engineForm, {
    ncads_source: "standard",
    ebitda_addback_stack: "conservative",
    officer_comp: "standard",
    affiliate_ownership: "standard",
    living_expense: "standard",
  });
  const gp = e.addBacks.find((a) => a.key === "GUARANTEED_PAYMENTS")?.value ?? 0;
  const interest = e.addBacks.find((a) => a.key === "INTEREST_EXPENSE")?.value ?? 0;
  const depr = e.addBacks.find((a) => a.key === "DEPRECIATION")?.value ?? 0;
  const amort = e.addBacks.find((a) => a.key === "AMORTIZATION")?.value ?? 0;
  const value = e.adjustedEbitda == null ? null : e.adjustedEbitda - gp;
  return {
    value,
    base: { key: e.baseKey ?? "UNKNOWN", label: e.baseLabel, value: e.baseValue },
    interest,
    depAmort: depr + amort,
    gpIncluded: gp,
  };
}

/**
 * SIGNED owner-comp normalization for Adjusted EBITDA: adds back the EXCESS over
 * a market replacement salary when the owner is over-paid, and DEDUCTS the
 * shortfall (a market replacement-manager salary) when the owner is under-paid —
 * never the full package. Sole-prop / unknown forms get no adjustment. Delegates
 * the market-rate computation to the existing analyzeOfficerComp engine (NG2).
 */
export function ownerCompExcess(inputs: SpreadInputs): { amount: number; note: string } {
  const form = resolveForm(inputs);
  if (form === "SOLE_PROP" || form === "UNKNOWN") {
    return {
      amount: 0,
      note:
        form === "SOLE_PROP"
          ? "Sole proprietor: net profit already is the owner's return — no owner-comp normalization."
          : "Entity form unknown — no owner-comp normalization (conservative).",
    };
  }
  const a = analyzeOfficerComp(inputs.facts, toEngineFormType(form));
  if (a.flag === "EXTREME_HIGH" && a.excessComp != null) {
    return { amount: a.excessComp, note: "Owner over-paid — excess over market replacement salary added back (not the full package)." };
  }
  if (a.flag === "EXTREME_LOW" && a.marketRateEstimate != null && a.reportedOfficerComp != null) {
    const shortfall = a.marketRateEstimate - a.reportedOfficerComp; // positive
    return { amount: -shortfall, note: "Owner under-paid — a market replacement-manager salary is DEDUCTED so EBITDA reflects true earnings capacity." };
  }
  return { amount: 0, note: "Owner compensation within market range — no normalization." };
}

/** Full owner-comp package for SDE (full officer comp + full guaranteed payments). */
export function fullOwnerComp(inputs: SpreadInputs): { amount: number; note: string } {
  const officer = num(inputs.facts["OFFICER_COMPENSATION"]) ?? 0;
  const gp = num(inputs.facts["GUARANTEED_PAYMENTS"]) ?? 0;
  return {
    amount: officer + gp,
    note: "SDE adds back the full owner-compensation package (officer comp + guaranteed payments) — seller's discretionary earnings basis.",
  };
}

/**
 * §179 acceleration-only treatment. §179 expensing is a TAX election, not a P&L
 * item, and is NOT a full add-back. Only the acceleration ABOVE the straight-line
 * equivalent is a legitimate cash-flow adjustment. Without asset-life data we
 * cannot derive straight-line, so the conservative default adds back NOTHING
 * unless an explicit acceleration fact (SECTION_179_ACCELERATION or a
 * STRAIGHT_LINE_DEPRECIATION baseline) is present.
 */
export function section179Acceleration(facts: Record<string, number | null>): { amount: number; note: string } {
  const explicit = num(facts["SECTION_179_ACCELERATION"]);
  if (explicit != null) {
    return { amount: Math.max(0, explicit), note: "§179 acceleration above straight-line (explicit)." };
  }
  const s179 = num(facts["SECTION_179_EXPENSE"]);
  const sl = num(facts["STRAIGHT_LINE_DEPRECIATION"]);
  if (s179 != null && sl != null) {
    return {
      amount: Math.max(0, s179 - sl),
      note: "§179 acceleration = §179 expense − straight-line equivalent (only the acceleration is added back).",
    };
  }
  return {
    amount: 0,
    note:
      s179 != null
        ? "§179 expense present but no straight-line baseline — NOT added back (conservative; §179 is not a full add-back)."
        : "no §179 expense.",
  };
}
