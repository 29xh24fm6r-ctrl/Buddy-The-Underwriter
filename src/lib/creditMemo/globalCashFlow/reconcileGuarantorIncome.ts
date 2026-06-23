/**
 * Guarantor Income Reconciliation
 *
 * Detects and explains material differences between PFS-stated income
 * and tax-return/spread AGI. Committee memos must not silently show
 * conflicting income numbers.
 *
 * Pure function — no DB, no server-only.
 */

export type IncomeSource = "PFS_STATED" | "TAX_RETURN_AGI" | "PERSONAL_INCOME_SPREAD" | "NONE";

export type IncomeReconciliation = {
  selected_income_for_gcf: number | null;
  selected_income_source: IncomeSource;
  alternate_income_values: Array<{ value: number; source: IncomeSource; label: string }>;
  reconciliation_note: string | null;
  warning_level: "none" | "note" | "warning" | "blocker";
};

const MATERIAL_PCT_THRESHOLD = 0.20;
const MATERIAL_ABS_THRESHOLD = 25_000;

function isMaterialDifference(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  const pctDiff = Math.max(a, b) > 0 ? diff / Math.max(a, b) : 0;
  return diff > MATERIAL_ABS_THRESHOLD || pctDiff > MATERIAL_PCT_THRESHOLD;
}

function fmt$(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}MM`;
  if (val >= 1_000) return `$${Math.round(val / 1_000).toLocaleString()}K`;
  return `$${Math.round(val).toLocaleString()}`;
}

export function reconcileGuarantorIncome(args: {
  pfsAnnualIncome: number | null;
  taxReturnAgi: number | null;
  personalIncomeSpreadTotal: number | null;
  guarantorName: string | null;
}): IncomeReconciliation {
  const { pfsAnnualIncome, taxReturnAgi, personalIncomeSpreadTotal, guarantorName } = args;
  const name = guarantorName ?? "Guarantor";

  const alternates: IncomeReconciliation["alternate_income_values"] = [];
  if (pfsAnnualIncome !== null) alternates.push({ value: pfsAnnualIncome, source: "PFS_STATED", label: "PFS-stated annual income" });
  if (taxReturnAgi !== null) alternates.push({ value: taxReturnAgi, source: "TAX_RETURN_AGI", label: "Tax-return AGI" });
  if (personalIncomeSpreadTotal !== null && personalIncomeSpreadTotal !== taxReturnAgi) {
    alternates.push({ value: personalIncomeSpreadTotal, source: "PERSONAL_INCOME_SPREAD", label: "Personal income spread total" });
  }

  // No income at all
  if (alternates.length === 0) {
    return {
      selected_income_for_gcf: null,
      selected_income_source: "NONE",
      alternate_income_values: [],
      reconciliation_note: `${name} personal income not available from PFS or tax returns.`,
      warning_level: "blocker",
    };
  }

  // Single source — use it directly
  if (alternates.length === 1) {
    return {
      selected_income_for_gcf: alternates[0].value,
      selected_income_source: alternates[0].source,
      alternate_income_values: alternates,
      reconciliation_note: null,
      warning_level: "none",
    };
  }

  // Multiple sources — check for material difference
  const primary = taxReturnAgi ?? personalIncomeSpreadTotal ?? pfsAnnualIncome!;
  const primarySource: IncomeSource = taxReturnAgi !== null ? "TAX_RETURN_AGI"
    : personalIncomeSpreadTotal !== null ? "PERSONAL_INCOME_SPREAD"
    : "PFS_STATED";

  // Check PFS vs tax
  if (pfsAnnualIncome !== null && (taxReturnAgi !== null || personalIncomeSpreadTotal !== null)) {
    const verifiedIncome = taxReturnAgi ?? personalIncomeSpreadTotal!;
    if (isMaterialDifference(pfsAnnualIncome, verifiedIncome)) {
      return {
        selected_income_for_gcf: primary,
        selected_income_source: primarySource,
        alternate_income_values: alternates,
        reconciliation_note: `PFS-stated annual income (${fmt$(pfsAnnualIncome)}) differs materially from tax-return/AGI income (${fmt$(verifiedIncome)}). Formal GCF should reconcile recurring income source before final approval.`,
        warning_level: "warning",
      };
    }
  }

  // Sources are close enough — no warning needed
  return {
    selected_income_for_gcf: primary,
    selected_income_source: primarySource,
    alternate_income_values: alternates,
    reconciliation_note: null,
    warning_level: "none",
  };
}
