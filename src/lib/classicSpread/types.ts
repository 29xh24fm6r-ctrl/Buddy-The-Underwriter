export type { PersonalIncomeSection, PersonalIncomeYear } from "./personalIncomeLoader";
import type { PersonalIncomeSection } from "./personalIncomeLoader";

export type StatementPeriod = {
  date: string; // "12/31/2023"
  months: number; // 12
  auditMethod: string; // "Tax Return" | "Reviewed" | "Audited" | "Compiled" | "Unaudited"
  stmtType: string; // "Annual" | "Interim"
  label: string; // "2023" | "YTD 2025"
};

export type FinancialRow = {
  label: string;
  indent: number; // 0 = section header, 1 = line item, 2 = sub-item
  isBold: boolean;
  values: (number | null)[]; // one per period, in period order
  showPct: boolean; // whether to show % column alongside value
  pctBase?: (number | null)[]; // denominator for % calc (usually revenue for IS, total assets for BS)
  isNegative?: boolean; // display in parentheses when positive (e.g. accumulated depreciation)
};

export type CashFlowRow = {
  label: string;
  indent: number; // 0 = section header, 1 = line item, 2 = sub-item
  isBold: boolean;
  values: (number | null)[]; // one per period
  isNegative?: boolean;
};

export type RatioRow = {
  label: string;
  values: (number | string | null)[]; // "N/A" allowed
  format: "number" | "percent" | "ratio" | "days" | "currency";
  decimals: number;
};

export type RatioSection = {
  title: string; // "LIQUIDITY" | "LEVERAGE" | etc.
  rows: RatioRow[];
};

export type GlobalCashFlowSponsor = {
  entityId: string;
  displayName: string;
  personalCashAvailable: number | null;
};

export type GlobalCashFlowSection = {
  taxYear: number | null;
  entityCashFlowAvailable: number | null;
  entityCount: number;
  sponsors: GlobalCashFlowSponsor[];
  globalCashFlow: number | null;
  proposedAnnualDebtService: number | null;
  globalDscr: number | null;
  coverageStatus: "ADEQUATE" | "TIGHT" | "DEFICIT" | "UNKNOWN";
  /**
   * SPEC-B4 — Methodology slate decisions used to compute this GCF.
   * One entry per axis, including defaults. PDF renderer skips Axis 5
   * (living_expense) to keep the methodology block compact.
   */
  methodology?: Array<{
    axisId: "ncads_source" | "ebitda_addback_stack" | "officer_comp" | "affiliate_ownership" | "living_expense";
    axisLabel: string;
    chosenVariantId: string;
    chosenVariantLabel: string;
    rationale: string;
    isDefault: boolean;
  }>;
};

export type ClassicSpreadInput = {
  // Deal metadata
  dealId: string;
  companyName: string;
  preparedDate: string; // "1:22 PM, 6/10/2024" format
  naicsCode: string | null;
  naicsDescription: string | null;
  bankName: string;

  // Periods (chronological order)
  periods: StatementPeriod[];

  // Financial statements
  balanceSheet: FinancialRow[];
  incomeStatement: FinancialRow[];

  // Cash flow (UCA indirect method)
  cashFlow: CashFlowRow[];
  cashFlowPeriods: StatementPeriod[];

  // Ratios
  ratioSections: RatioSection[];

  // Global cash flow (entity + personal aggregation)
  globalCashFlow: GlobalCashFlowSection | null;

  // Personal income (Form 1040 guarantor summary)
  personalIncome?: PersonalIncomeSection | null;

  // Executive summary (combined BS + IS condensed)
  executiveSummary: {
    assets: FinancialRow[];
    liabilitiesAndNetWorth: FinancialRow[];
    incomeStatement: FinancialRow[];
  };

  // SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1 (Phase 6): the certification audit
  // applied to this input before render (suppression/replacement decisions + per-domain status).
  // Persisted into rendered_json; never rendered as a page.
  certificationAudit?: import("./certification/certifiedSpreadGateCore").ClassicSpreadCertificationAudit | null;

  // SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2 #9: fail-closed certification flag. False when the
  // certification gate threw or returned null — the PDF must visibly render NOT CERTIFIED rather
  // than silently presenting an apparently-certified spread.
  certified?: boolean;
};
