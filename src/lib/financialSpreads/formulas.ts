import type { RenderedSpreadCellV2, RenderedSpreadInputRef } from "@/lib/financialSpreads/types";

export type FormulaId = "EXCESS_CASH_FLOW" | "DSCR" | "DSCR_STRESSED_300BPS";

export type T12RowKey =
  | "GROSS_RENTAL_INCOME"
  | "VACANCY_CONCESSIONS"
  | "OTHER_INCOME"
  | "TOTAL_INCOME"
  | "REPAIRS_MAINTENANCE"
  | "UTILITIES"
  | "PROPERTY_MANAGEMENT"
  | "REAL_ESTATE_TAXES"
  | "INSURANCE"
  | "PAYROLL"
  | "MARKETING"
  | "PROFESSIONAL_FEES"
  | "OTHER_OPEX"
  | "TOTAL_OPEX"
  | "NOI"
  | "REPLACEMENT_RESERVES"
  | "CAPEX"
  | "TOTAL_CAPEX"
  | "NET_CASH_FLOW_BEFORE_DEBT"
  | "DEBT_SERVICE"
  | "CASH_FLOW_AFTER_DEBT"
  | "OPEX_RATIO"
  | "NOI_MARGIN";

export type T12FormulaId =
  | "T12_TOTAL_INCOME"
  | "T12_TOTAL_OPEX"
  | "T12_NOI"
  | "T12_TOTAL_CAPEX"
  | "T12_NET_CASH_FLOW_BEFORE_DEBT"
  | "T12_OPEX_RATIO"
  | "T12_NOI_MARGIN";

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

function safeSum(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

export function computeFormula(
  id: FormulaId,
  inputs: Record<string, number | null>,
): { value: number | null; inputs_used: RenderedSpreadInputRef[] } {
  switch (id) {
    case "EXCESS_CASH_FLOW": {
      const cfa = inputs.CASH_FLOW_AVAILABLE ?? null;
      const ads = inputs.ANNUAL_DEBT_SERVICE ?? null;
      return {
        value: cfa !== null && ads !== null ? cfa - ads : null,
        inputs_used: [
          { fact_type: "FINANCIAL_ANALYSIS", fact_key: "CASH_FLOW_AVAILABLE" },
          { fact_type: "FINANCIAL_ANALYSIS", fact_key: "ANNUAL_DEBT_SERVICE" },
        ],
      };
    }
    case "DSCR": {
      const cfa = inputs.CASH_FLOW_AVAILABLE ?? null;
      const ads = inputs.ANNUAL_DEBT_SERVICE ?? null;
      return {
        value: safeDivide(cfa, ads),
        inputs_used: [
          { fact_type: "FINANCIAL_ANALYSIS", fact_key: "CASH_FLOW_AVAILABLE" },
          { fact_type: "FINANCIAL_ANALYSIS", fact_key: "ANNUAL_DEBT_SERVICE" },
        ],
      };
    }
    case "DSCR_STRESSED_300BPS": {
      const cfa = inputs.CASH_FLOW_AVAILABLE ?? null;
      const adsStressed = inputs.ANNUAL_DEBT_SERVICE_STRESSED_300BPS ?? null;
      return {
        value: safeDivide(cfa, adsStressed),
        inputs_used: [
          { fact_type: "FINANCIAL_ANALYSIS", fact_key: "CASH_FLOW_AVAILABLE" },
          { fact_type: "FINANCIAL_ANALYSIS", fact_key: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS" },
        ],
      };
    }
  }
}

const T12_OPEX_KEYS: T12RowKey[] = [
  "REPAIRS_MAINTENANCE",
  "UTILITIES",
  "PROPERTY_MANAGEMENT",
  "REAL_ESTATE_TAXES",
  "INSURANCE",
  "PAYROLL",
  "MARKETING",
  "PROFESSIONAL_FEES",
  "OTHER_OPEX",
];

export function computeT12Formula(args: {
  formula: T12FormulaId;
  get: (rowKey: T12RowKey) => number | null;
}): { value: number | null; inputs_used: T12RowKey[] } {
  switch (args.formula) {
    case "T12_TOTAL_INCOME": {
      const gross = args.get("GROSS_RENTAL_INCOME");
      const other = args.get("OTHER_INCOME");
      const vac = args.get("VACANCY_CONCESSIONS");
      const value = safeSum([gross, other, vac !== null ? -vac : null]);
      return { value, inputs_used: ["GROSS_RENTAL_INCOME", "OTHER_INCOME", "VACANCY_CONCESSIONS"] };
    }
    case "T12_TOTAL_OPEX": {
      const value = safeSum(T12_OPEX_KEYS.map((k) => args.get(k)));
      return { value, inputs_used: T12_OPEX_KEYS };
    }
    case "T12_NOI": {
      const income = args.get("TOTAL_INCOME");
      const opex = args.get("TOTAL_OPEX");
      return { value: income !== null && opex !== null ? income - opex : null, inputs_used: ["TOTAL_INCOME", "TOTAL_OPEX"] };
    }
    case "T12_TOTAL_CAPEX": {
      const rr = args.get("REPLACEMENT_RESERVES");
      const capex = args.get("CAPEX");
      return { value: safeSum([rr, capex]), inputs_used: ["REPLACEMENT_RESERVES", "CAPEX"] };
    }
    case "T12_NET_CASH_FLOW_BEFORE_DEBT": {
      const noi = args.get("NOI");
      const capex = args.get("TOTAL_CAPEX");
      return { value: noi !== null && capex !== null ? noi - capex : null, inputs_used: ["NOI", "TOTAL_CAPEX"] };
    }
    case "T12_OPEX_RATIO": {
      const opex = args.get("TOTAL_OPEX");
      const income = args.get("TOTAL_INCOME");
      return { value: safeDivide(opex, income), inputs_used: ["TOTAL_OPEX", "TOTAL_INCOME"] };
    }
    case "T12_NOI_MARGIN": {
      const noi = args.get("NOI");
      const income = args.get("TOTAL_INCOME");
      return { value: safeDivide(noi, income), inputs_used: ["NOI", "TOTAL_INCOME"] };
    }
  }
}

export function computedCell(args: {
  formula: FormulaId;
  inputs: Record<string, number | null>;
  as_of_date?: string | null;
  citations?: any[];
  notes?: string | null;
}): RenderedSpreadCellV2 {
  const computed = computeFormula(args.formula, args.inputs);
  return {
    value: computed.value,
    as_of_date: args.as_of_date ?? null,
    formula_ref: args.formula,
    inputs_used: computed.inputs_used,
    citations: args.citations,
    notes: args.notes,
  };
}
