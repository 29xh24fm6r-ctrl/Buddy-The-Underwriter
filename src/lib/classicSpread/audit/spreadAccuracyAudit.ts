/**
 * SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1 — pure audit layer.
 *
 * Proves a classic spread is COMPLETE and NUMERICALLY ACCURATE against the uploaded financial
 * facts BEFORE the PDF is trusted. Compares the rendered rows (what the PDF shows, post-
 * certification suppression) against the source facts the spread was built from (`byPeriod`):
 *
 *   - statement footing (balance sheet, income statement, UCA cash flow)
 *   - missing-line detection (source extracted but unmapped; required/derived row blank while
 *     inputs exist; total derived from a fallback instead of a direct source)
 *   - reconciliation severity (blocker / warning / info) with expected/actual/difference/tolerance
 *
 * NOTHING here does IO. No Supabase, no canonical VM, no reconcileFinancialFacts. The loader
 * supplies `byPeriod` (the exact source values the rows were built from) + the rendered rows.
 */

import type { CashFlowRow, FinancialRow } from "../types";
import type { PeriodMaps } from "../classicSpreadRatios";
import {
  resolveBalanceSheet,
  resolveIncomeStatement1120,
  type Facts,
  type ResolverFinding,
} from "./statementTruthResolver";
import {
  classifySpreadFindingAction,
  isUnresolvedAction,
  type SpreadFindingAction,
  type SpreadFindingActionItem,
} from "./spreadFindingActions";

// ── finding schema ────────────────────────────────────────────────────────────

export type SpreadAuditStatement = "balance_sheet" | "income_statement" | "cash_flow";

export type SpreadAuditIssueType =
  | "missing_source_mapping"
  | "missing_required_value"
  | "formula_mismatch"
  | "derived_from_fallback"
  | "contradictory_components"
  | "unreconciled_total"
  // SPEC-CLASSIC-SPREAD-STATEMENT-TRUTH-RESOLVER-1
  | "missing_implied_component"
  | "rejected_source_value";

export type SpreadAuditSeverity = "blocker" | "warning" | "info";

export type SpreadAuditFinding = {
  period: string; // period label (e.g. "2024")
  statement: SpreadAuditStatement;
  rowLabel: string;
  issueType: SpreadAuditIssueType;
  expectedValue: number | null;
  actualValue: number | null;
  difference: number | null;
  tolerance: number;
  sourceFactIds: string[];
  documentIds: string[];
  severity: SpreadAuditSeverity;
  detail: string;
};

export type SpreadAuditResult = {
  status: "clean" | "warning" | "blocker";
  findings: SpreadAuditFinding[];
  summary: {
    blockers: number;
    warnings: number;
    infos: number;
    periodsAudited: string[];
    footingsChecked: number;
    mappedFactKeys: number;
    unmappedFactKeys: number;
  };
  /** period/row cells carrying a blocker — narrative guardrail must not draw strong conclusions here. */
  blockedCells: { period: string; statement: SpreadAuditStatement; rowLabel: string }[];
  /**
   * SPEC-CLASSIC-SPREAD-BLOCKER-BATCH-RESOLUTION-1 #4: blockers grouped into operational source-review
   * actions so they are actionable, not just diagnostic.
   */
  actionSummary: {
    byPeriod: Record<string, number>;
    byDocument: Record<string, number>;
    byAction: Partial<Record<SpreadFindingAction, number>>;
    unresolvedActionCount: number;
    actions: SpreadFindingActionItem[];
  };
};

export type AuditFactRef = {
  period: string; // ISO date
  factKey: string;
  factId: string | null;
  documentId: string | null;
};

export type AuditInput = {
  periods: { iso: string; label: string }[];
  byPeriod: PeriodMaps;
  balanceSheet: FinancialRow[];
  incomeStatement: FinancialRow[];
  cashFlow: CashFlowRow[];
  factRefs?: AuditFactRef[];
  /**
   * SPEC-CLASSIC-SPREAD-STATEMENT-TRUTH-RESOLVER-1: also run the statement truth resolvers over the
   * candidate facts and append their arbitration findings (rejected/suspect source values, implied
   * missing components, formula mismatches). Off by default so the footing-only checks are testable
   * in isolation; the loader turns it ON.
   */
  resolve?: boolean;
};

// ── tolerance ───────────────────────────────────────────────────────────────

const ABS_TOL = 1; // $1 — round-off floor
const REL_TOL = 0.005; // 0.5% of the expected magnitude

function toleranceFor(expected: number | null): number {
  const base = expected != null ? Math.abs(expected) : 0;
  return Math.max(ABS_TOL, Math.round(REL_TOL * base));
}

/** A difference is "material" when it exceeds 1% of the statement base (assets / revenue). */
function isMaterial(diff: number, base: number | null): boolean {
  const floor = 100;
  const threshold = base != null ? Math.max(floor, 0.01 * Math.abs(base)) : floor;
  return Math.abs(diff) > threshold;
}

// ── fact-key taxonomy (what the BS/IS/CF rows legitimately consume) ───────────

const BS_KEYS = [
  "SL_TOTAL_ASSETS", "SL_CASH", "SL_AR_GROSS", "SL_AR_ALLOWANCE", "SL_INVENTORY",
  "SL_US_GOV_OBLIGATIONS", "SL_TAX_EXEMPT_SECURITIES", "SL_OTHER_CURRENT_ASSETS",
  "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS", "SL_SHAREHOLDER_LOANS_RECEIVABLE",
  "SL_MORTGAGE_LOANS", "SL_OTHER_INVESTMENTS", "SL_PPE_GROSS", "SL_ACCUMULATED_DEPRECIATION",
  "SL_DEPLETABLE_ASSETS", "SL_LAND", "SL_INTANGIBLES_GROSS", "SL_ACCUMULATED_AMORTIZATION",
  "SL_OTHER_ASSETS", "SL_ACCOUNTS_PAYABLE", "SL_WAGES_PAYABLE", "SL_SHORT_TERM_DEBT",
  "SL_OPERATING_CURRENT_LIABILITIES", "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES",
  "SL_MORTGAGES_NOTES_BONDS", "SL_LOANS_FROM_SHAREHOLDERS", "SL_OTHER_LIABILITIES",
  "SL_TOTAL_LIABILITIES", "SL_CAPITAL_STOCK", "SL_RETAINED_EARNINGS", "SL_TOTAL_EQUITY",
];
const IS_KEYS = [
  "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME", "COST_OF_GOODS_SOLD", "GROSS_PROFIT",
  "OFFICER_COMPENSATION", "SALARIES_WAGES", "SALARIES_WAGES_IS", "RENT_EXPENSE", "RENT_EXPENSE_IS",
  "REPAIRS_MAINTENANCE", "REPAIRS_MAINTENANCE_IS", "BAD_DEBT_EXPENSE", "BAD_DEBT_EXPENSE_IS",
  "TAXES_LICENSES", "DEPRECIATION", "AMORTIZATION", "INTEREST_EXPENSE", "ADVERTISING",
  "ADVERTISING_IS", "PENSION_PROFIT_SHARING", "EMPLOYEE_BENEFITS", "INSURANCE_EXPENSE",
  "INSURANCE_EXPENSE_IS", "OTHER_DEDUCTIONS", "OTHER_DEDUCTIONS_IS", "OTHER_OPERATING_EXPENSES_IS",
  "TOTAL_OPERATING_EXPENSES", "TOTAL_DEDUCTIONS", "OPERATING_INCOME", "OTHER_INCOME",
  "NET_INCOME", "ORDINARY_BUSINESS_INCOME", "DISTRIBUTIONS",
];
// Keys legitimately surfaced on OTHER pages (GCF / personal income) or that are metadata markers —
// they are "intentionally ignored" by the BS/IS/CF audit, NOT unmapped.
const IGNORED_KEYS = new Set([
  // statement-type / document markers
  "INCOME_STATEMENT", "BALANCE_SHEET", "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "CASH_FLOW",
  // global cash flow page
  "GCF_GLOBAL_CASH_FLOW", "GLOBAL_CASH_FLOW", "GCF_DSCR", "GCF_CASH_AVAILABLE",
  "ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_PROPOSED", "TOTAL_PERSONAL_INCOME",
  "CASH_FLOW_AVAILABLE", "NOI_TTM", "EBITDA",
  // personal income page (Form 1040 guarantor summary)
  "WAGES_W2", "ADJUSTED_GROSS_INCOME", "TAXABLE_INCOME", "TOTAL_TAX", "STANDARD_DEDUCTION",
  "QBI_DEDUCTION", "SCH_C_NET", "SCH_E_NET", "SCH_E_DEPRECIATION", "K1_ORDINARY_INCOME",
  "SOCIAL_SECURITY", "PENSION_ANNUITY", "CAPITAL_GAINS", "ORDINARY_DIVIDENDS", "TAXABLE_INTEREST",
]);
const MAPPED_KEYS = new Set([...BS_KEYS, ...IS_KEYS]);

// ── value access ──────────────────────────────────────────────────────────────

function src(byPeriod: PeriodMaps, period: string, key: string): number | null {
  return byPeriod.get(period)?.get(key) ?? null;
}
/** First non-null across key variants. */
function srcAny(byPeriod: PeriodMaps, period: string, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = src(byPeriod, period, k);
    if (v != null) return v;
  }
  return null;
}
function rowVal(rows: { label: string; values: (number | null)[] }[], label: string, i: number): number | null {
  const r = rows.find((rr) => rr.label === label);
  return r ? (r.values[i] ?? null) : null;
}

/** Flatten one period's byPeriod map into the resolver's Facts record. */
function factsForPeriod(byPeriod: PeriodMaps, iso: string): Facts {
  const out: Facts = {};
  const m = byPeriod.get(iso);
  if (m) for (const [k, v] of m) out[k] = v;
  return out;
}

/** Map a resolver finding into the audit's finding shape. */
function toAuditFinding(rf: ResolverFinding, period: string, statement: SpreadAuditStatement): SpreadAuditFinding {
  return {
    period, statement, rowLabel: rf.rowLabel, issueType: rf.issueType,
    expectedValue: rf.expectedValue, actualValue: rf.actualValue, difference: rf.difference,
    tolerance: Math.max(1, Math.round(0.005 * Math.abs(rf.expectedValue ?? rf.actualValue ?? 0))),
    sourceFactIds: [], documentIds: [], severity: rf.severity, detail: rf.detail,
  };
}
/** Sum the present (non-null) components; null when NONE is present. */
function sumPresent(components: (number | null)[]): number | null {
  const present = components.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

// ── main audit ────────────────────────────────────────────────────────────────

export function auditClassicSpread(input: AuditInput): SpreadAuditResult {
  const { periods, byPeriod, balanceSheet, incomeStatement, cashFlow, factRefs = [] } = input;
  const findings: SpreadAuditFinding[] = [];
  let footingsChecked = 0;

  const refsFor = (isoPeriod: string, ...keys: string[]) => {
    const ids: string[] = [];
    const docs: string[] = [];
    for (const r of factRefs) {
      if (r.period === isoPeriod && keys.includes(r.factKey)) {
        if (r.factId) ids.push(r.factId);
        if (r.documentId) docs.push(r.documentId);
      }
    }
    return { sourceFactIds: Array.from(new Set(ids)), documentIds: Array.from(new Set(docs)) };
  };

  const push = (
    f: Omit<SpreadAuditFinding, "sourceFactIds" | "documentIds"> & { iso: string; keys: string[] },
  ) => {
    const { iso, keys, ...rest } = f;
    const { sourceFactIds, documentIds } = refsFor(iso, ...keys);
    findings.push({ ...rest, sourceFactIds, documentIds });
  };

  // Compare an expected (component-derived) value against the rendered total.
  function checkTotal(args: {
    iso: string;
    label: string;
    statement: SpreadAuditStatement;
    componentKeys: string[]; // source keys that feed the expected
    expected: number | null; // component-derived expected (null = no components present)
    rendered: number | null; // value shown on the PDF
    directSource: number | null; // a directly-stored total fact, if any
    base: number | null; // statement base for materiality (assets / revenue)
    period: string; // label
  }) {
    const { iso, label, statement, componentKeys, expected, rendered, directSource, base, period } = args;
    if (expected == null) return; // nothing to reconcile against
    footingsChecked++;
    const tol = toleranceFor(expected);

    // Required/derived row blank while inputs exist → the spread is incomplete.
    if (rendered == null) {
      push({
        iso, keys: componentKeys, period, statement, rowLabel: label,
        issueType: "missing_required_value",
        expectedValue: expected, actualValue: null, difference: null, tolerance: tol,
        severity: "blocker",
        detail: `${label} is blank but component inputs sum to ${expected}. A trusted spread must show this total or certify it unavailable with a reason.`,
      });
      return;
    }

    const diff = rendered - expected;
    if (Math.abs(diff) <= tol) return; // foots

    if (directSource != null && Math.abs(rendered - directSource) <= tol) {
      // The rendered value matches a directly-stored source total but the components disagree.
      push({
        iso, keys: componentKeys, period, statement, rowLabel: label,
        issueType: "contradictory_components",
        expectedValue: expected, actualValue: rendered, difference: diff, tolerance: tol,
        severity: "warning",
        detail: `${label} matches the directly-stored total (${directSource}) but its components sum to ${expected} (diff ${diff}).`,
      });
      return;
    }

    push({
      iso, keys: componentKeys, period, statement, rowLabel: label,
      issueType: "unreconciled_total",
      expectedValue: expected, actualValue: rendered, difference: diff, tolerance: tol,
      severity: isMaterial(diff, base) ? "blocker" : "warning",
      detail: `${label} (${rendered}) does not reconcile to its components (${expected}); diff ${diff} exceeds tolerance ${tol}.`,
    });
  }

  // Compare a formula (expected from other rendered rows) against a rendered row.
  function checkFormula(args: {
    iso: string; keys: string[]; period: string; label: string; statement: SpreadAuditStatement;
    expected: number | null; rendered: number | null; base: number | null;
    blankWhenInputsExist: boolean; // if expected derivable but rendered blank → missing_required_value
  }) {
    const { iso, keys, period, label, statement, expected, rendered, base, blankWhenInputsExist } = args;
    if (expected == null) return;
    footingsChecked++;
    const tol = toleranceFor(expected);
    if (rendered == null) {
      if (!blankWhenInputsExist) return;
      push({
        iso, keys, period, statement, rowLabel: label,
        issueType: "missing_required_value",
        expectedValue: expected, actualValue: null, difference: null, tolerance: tol,
        severity: "blocker",
        detail: `${label} is blank but is derivable from available inputs (= ${expected}).`,
      });
      return;
    }
    const diff = rendered - expected;
    if (Math.abs(diff) <= tol) return;
    push({
      iso, keys, period, statement, rowLabel: label,
      issueType: "formula_mismatch",
      expectedValue: expected, actualValue: rendered, difference: diff, tolerance: tol,
      severity: isMaterial(diff, base) ? "blocker" : "warning",
      detail: `${label} (${rendered}) != expected ${expected} (diff ${diff}).`,
    });
  }

  for (let i = 0; i < periods.length; i++) {
    const { iso, label } = periods[i]!;

    // ── Balance Sheet ─────────────────────────────────────────────────────────
    const totalAssets = src(byPeriod, iso, "SL_TOTAL_ASSETS");

    // Net AR: derived row blank when gross exists (allowance optional) is a real gap.
    const grossAr = src(byPeriod, iso, "SL_AR_GROSS");
    if (grossAr != null) {
      const allowance = src(byPeriod, iso, "SL_AR_ALLOWANCE");
      const expectedNetAr = grossAr - (allowance ?? 0);
      checkFormula({
        iso, keys: ["SL_AR_GROSS", "SL_AR_ALLOWANCE"], period: label, label: "Net Accounts Receivable",
        statement: "balance_sheet", expected: expectedNetAr,
        rendered: rowVal(balanceSheet, "Net Accounts Receivable", i), base: totalAssets,
        blankWhenInputsExist: true,
      });
    }

    const netAr = (() => { const g = src(byPeriod, iso, "SL_AR_GROSS"); return g != null ? g - (src(byPeriod, iso, "SL_AR_ALLOWANCE") ?? 0) : null; })();
    const expectedTCA = sumPresent([
      src(byPeriod, iso, "SL_CASH"), netAr, src(byPeriod, iso, "SL_INVENTORY"),
      src(byPeriod, iso, "SL_US_GOV_OBLIGATIONS"), src(byPeriod, iso, "SL_TAX_EXEMPT_SECURITIES"),
      src(byPeriod, iso, "SL_OTHER_CURRENT_ASSETS"),
    ]);
    checkTotal({
      iso, label: "TOTAL CURRENT ASSETS", statement: "balance_sheet",
      componentKeys: ["SL_CASH", "SL_AR_GROSS", "SL_INVENTORY", "SL_US_GOV_OBLIGATIONS", "SL_TAX_EXEMPT_SECURITIES", "SL_OTHER_CURRENT_ASSETS"],
      expected: expectedTCA, rendered: rowVal(balanceSheet, "TOTAL CURRENT ASSETS", i),
      directSource: srcAny(byPeriod, iso, "TOTAL_CURRENT_ASSETS", "SL_TOTAL_CURRENT_ASSETS"),
      base: totalAssets, period: label,
    });

    const expectedTNCA = sumPresent([
      src(byPeriod, iso, "SL_SHAREHOLDER_LOANS_RECEIVABLE"), src(byPeriod, iso, "SL_MORTGAGE_LOANS"),
      src(byPeriod, iso, "SL_OTHER_INVESTMENTS"),
      (() => { const ppe = src(byPeriod, iso, "SL_PPE_GROSS"); return ppe != null ? ppe - (src(byPeriod, iso, "SL_ACCUMULATED_DEPRECIATION") ?? 0) : null; })(),
      src(byPeriod, iso, "SL_DEPLETABLE_ASSETS"), src(byPeriod, iso, "SL_LAND"),
      (() => { const ig = src(byPeriod, iso, "SL_INTANGIBLES_GROSS"); return ig != null ? ig - (src(byPeriod, iso, "SL_ACCUMULATED_AMORTIZATION") ?? 0) : null; })(),
      src(byPeriod, iso, "SL_OTHER_ASSETS"),
    ]);
    checkTotal({
      iso, label: "TOTAL NON-CURRENT ASSETS", statement: "balance_sheet",
      componentKeys: ["SL_SHAREHOLDER_LOANS_RECEIVABLE", "SL_MORTGAGE_LOANS", "SL_OTHER_INVESTMENTS", "SL_PPE_GROSS", "SL_DEPLETABLE_ASSETS", "SL_LAND", "SL_INTANGIBLES_GROSS", "SL_OTHER_ASSETS"],
      expected: expectedTNCA, rendered: rowVal(balanceSheet, "TOTAL NON-CURRENT ASSETS", i),
      directSource: null, base: totalAssets, period: label,
    });

    // Total Assets = TCA + TNCA
    {
      const tca = rowVal(balanceSheet, "TOTAL CURRENT ASSETS", i);
      const tnca = rowVal(balanceSheet, "TOTAL NON-CURRENT ASSETS", i);
      const renderedTA = rowVal(balanceSheet, "TOTAL ASSETS", i);
      checkFormula({
        iso, keys: ["SL_TOTAL_ASSETS"], period: label, label: "TOTAL ASSETS", statement: "balance_sheet",
        expected: tca != null && tnca != null ? tca + tnca : null, rendered: renderedTA,
        base: totalAssets, blankWhenInputsExist: tca != null && tnca != null,
      });
    }

    // Current liabilities
    const expectedTCL = sumPresent([
      src(byPeriod, iso, "SL_ACCOUNTS_PAYABLE"), src(byPeriod, iso, "SL_WAGES_PAYABLE"),
      src(byPeriod, iso, "SL_SHORT_TERM_DEBT"), src(byPeriod, iso, "SL_OPERATING_CURRENT_LIABILITIES"),
    ]);
    checkTotal({
      iso, label: "TOTAL CURRENT LIABILITIES", statement: "balance_sheet",
      componentKeys: ["SL_ACCOUNTS_PAYABLE", "SL_WAGES_PAYABLE", "SL_SHORT_TERM_DEBT", "SL_OPERATING_CURRENT_LIABILITIES"],
      expected: expectedTCL, rendered: rowVal(balanceSheet, "TOTAL CURRENT LIABILITIES", i),
      directSource: srcAny(byPeriod, iso, "TOTAL_CURRENT_LIABILITIES", "SL_TOTAL_CURRENT_LIABILITIES"),
      base: totalAssets, period: label,
    });

    // Non-current liabilities = mortgages + loans from shareholders + other liabilities
    const expectedTNCL = sumPresent([
      src(byPeriod, iso, "SL_MORTGAGES_NOTES_BONDS"), src(byPeriod, iso, "SL_LOANS_FROM_SHAREHOLDERS"),
      src(byPeriod, iso, "SL_OTHER_LIABILITIES"),
    ]);
    checkTotal({
      iso, label: "TOTAL NON-CURRENT LIABILITIES", statement: "balance_sheet",
      componentKeys: ["SL_MORTGAGES_NOTES_BONDS", "SL_LOANS_FROM_SHAREHOLDERS", "SL_OTHER_LIABILITIES"],
      expected: expectedTNCL, rendered: rowVal(balanceSheet, "TOTAL NON-CURRENT LIABILITIES", i),
      directSource: null, base: totalAssets, period: label,
    });

    // Total liabilities — direct fact, else current + non-current components.
    const directTL = src(byPeriod, iso, "SL_TOTAL_LIABILITIES");
    const expectedTL = directTL ?? (expectedTCL != null || expectedTNCL != null ? (expectedTCL ?? 0) + (expectedTNCL ?? 0) : null);
    checkTotal({
      iso, label: "TOTAL LIABILITIES", statement: "balance_sheet",
      componentKeys: ["SL_TOTAL_LIABILITIES", "SL_ACCOUNTS_PAYABLE", "SL_WAGES_PAYABLE", "SL_SHORT_TERM_DEBT", "SL_OPERATING_CURRENT_LIABILITIES", "SL_MORTGAGES_NOTES_BONDS", "SL_LOANS_FROM_SHAREHOLDERS", "SL_OTHER_LIABILITIES"],
      expected: expectedTL, rendered: rowVal(balanceSheet, "TOTAL LIABILITIES", i),
      directSource: directTL, base: totalAssets, period: label,
    });

    // Net worth = capital stock + retained earnings, or direct equity.
    const directEquity = src(byPeriod, iso, "SL_TOTAL_EQUITY");
    const expectedNW = directEquity ?? sumPresent([src(byPeriod, iso, "SL_CAPITAL_STOCK"), src(byPeriod, iso, "SL_RETAINED_EARNINGS")]);
    checkTotal({
      iso, label: "TOTAL NET WORTH", statement: "balance_sheet",
      componentKeys: ["SL_TOTAL_EQUITY", "SL_CAPITAL_STOCK", "SL_RETAINED_EARNINGS"],
      expected: expectedNW, rendered: rowVal(balanceSheet, "TOTAL NET WORTH", i),
      directSource: directEquity, base: totalAssets, period: label,
    });

    // Balance equation: Total Liabilities + Net Worth = Total Assets.
    {
      const tl = rowVal(balanceSheet, "TOTAL LIABILITIES", i);
      const nw = rowVal(balanceSheet, "TOTAL NET WORTH", i);
      const ta = rowVal(balanceSheet, "TOTAL ASSETS", i);
      if (tl != null && nw != null && ta != null) {
        footingsChecked++;
        const expected = tl + nw;
        const diff = ta - expected;
        const tol = toleranceFor(ta);
        if (Math.abs(diff) > tol) {
          push({
            iso, keys: ["SL_TOTAL_ASSETS", "SL_TOTAL_LIABILITIES", "SL_TOTAL_EQUITY"], period: label,
            statement: "balance_sheet", rowLabel: "TOTAL LIABILITIES & NET WORTH",
            issueType: "unreconciled_total",
            expectedValue: ta, actualValue: expected, difference: diff, tolerance: tol,
            severity: "blocker",
            detail: `Balance sheet does not balance: Liabilities (${tl}) + Net Worth (${nw}) = ${expected} != Total Assets ${ta} (diff ${diff}).`,
          });
        }
      }
    }

    // ── Income Statement ──────────────────────────────────────────────────────
    const revenue = srcAny(byPeriod, iso, "GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME");
    if (revenue != null) {
      const cogs = src(byPeriod, iso, "COST_OF_GOODS_SOLD");
      checkFormula({
        iso, keys: ["GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME", "COST_OF_GOODS_SOLD"], period: label,
        label: "GROSS PROFIT", statement: "income_statement",
        expected: revenue - (cogs ?? 0), rendered: rowVal(incomeStatement, "GROSS PROFIT", i),
        base: revenue, blankWhenInputsExist: true,
      });

      // Net Operating Profit = Gross Profit − Total Operating Expense
      const gp = rowVal(incomeStatement, "GROSS PROFIT", i);
      const opex = rowVal(incomeStatement, "TOTAL OPERATING EXPENSE", i);
      if (gp != null && opex != null) {
        checkFormula({
          iso, keys: ["TOTAL_OPERATING_EXPENSES"], period: label, label: "NET OPERATING PROFIT",
          statement: "income_statement", expected: gp - opex,
          rendered: rowVal(incomeStatement, "NET OPERATING PROFIT", i), base: revenue,
          blankWhenInputsExist: true,
        });
      }

      // Net Profit = Net Operating Profit + Other Income/(Expense)
      const nop = rowVal(incomeStatement, "NET OPERATING PROFIT", i);
      const otherIncome = src(byPeriod, iso, "OTHER_INCOME") ?? 0;
      const directNI = srcAny(byPeriod, iso, "NET_INCOME", "ORDINARY_BUSINESS_INCOME");
      const renderedNP = rowVal(incomeStatement, "NET PROFIT", i);
      if (renderedNP == null) {
        // Blank Net Profit: derivable from inputs → required-value blocker; else missing-source.
        if (directNI != null || nop != null) {
          const expected = directNI ?? (nop! + otherIncome);
          push({
            iso, keys: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME"], period: label, statement: "income_statement",
            rowLabel: "NET PROFIT", issueType: "missing_required_value",
            expectedValue: expected, actualValue: null, difference: null, tolerance: toleranceFor(expected),
            severity: "blocker",
            detail: `NET PROFIT is blank but is derivable (= ${expected}).`,
          });
        } else {
          push({
            iso, keys: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME"], period: label, statement: "income_statement",
            rowLabel: "NET PROFIT", issueType: "missing_source_mapping",
            expectedValue: null, actualValue: null, difference: null, tolerance: ABS_TOL,
            severity: "warning",
            detail: `NET PROFIT is blank and not derivable — no net-income or operating-profit inputs for ${label}.`,
          });
        }
      } else if (directNI != null) {
        checkFormula({
          iso, keys: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME"], period: label, label: "NET PROFIT",
          statement: "income_statement", expected: directNI, rendered: renderedNP, base: revenue,
          blankWhenInputsExist: false,
        });
      }
    }

    // EBITDA = EBIT + Dep + Amort
    {
      const ebit = rowVal(incomeStatement, "EBIT", i);
      const depAmort = rowVal(incomeStatement, "Dep & Amort", i);
      if (ebit != null && depAmort != null) {
        checkFormula({
          iso, keys: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME", "DEPRECIATION", "AMORTIZATION", "INTEREST_EXPENSE"],
          period: label, label: "EBITDA", statement: "income_statement",
          expected: ebit + depAmort, rendered: rowVal(incomeStatement, "EBITDA", i), base: revenue,
          blankWhenInputsExist: true,
        });
      }
    }

    // ── Cash Flow (UCA) — needs a prior period for deltas ──────────────────────
    if (i >= 1) {
      const prevIso = periods[i - 1]!.iso;
      // #7: the AR working-capital delta reconciles on the NET AR basis (gross − allowance), matching
      // the balance sheet and the loader's UCA AR delta — not raw gross.
      const netArAt = (p: string): number | null => {
        const g = src(byPeriod, p, "SL_AR_GROSS");
        return g != null ? g - (src(byPeriod, p, "SL_AR_ALLOWANCE") ?? 0) : null;
      };
      const wcChecks: { label: string; keys: string[]; valueAt: (p: string) => number | null; invert: boolean }[] = [
        { label: "(Inc) / Dec in Accounts Receivable", keys: ["SL_AR_GROSS", "SL_AR_ALLOWANCE"], valueAt: netArAt, invert: false },
        { label: "(Inc) / Dec in Inventory", keys: ["SL_INVENTORY"], valueAt: (p) => src(byPeriod, p, "SL_INVENTORY"), invert: false },
        { label: "Inc / (Dec) in Accounts Payable", keys: ["SL_ACCOUNTS_PAYABLE"], valueAt: (p) => src(byPeriod, p, "SL_ACCOUNTS_PAYABLE"), invert: true },
      ];
      for (const c of wcChecks) {
        const cur = c.valueAt(iso);
        const prev = c.valueAt(prevIso);
        if (cur == null || prev == null) continue;
        const expected = c.invert ? cur - prev : prev - cur;
        checkFormula({
          iso, keys: c.keys, period: label, label: c.label, statement: "cash_flow",
          expected, rendered: rowVal(cashFlow, c.label, i), base: totalAssets, blankWhenInputsExist: false,
        });
      }

      // CFO = Net Income + D&A + Net Working Capital Change
      const ni = rowVal(cashFlow, "Net Income", i);
      const da = rowVal(cashFlow, "Depreciation & Amortization", i) ?? 0;
      const wc = rowVal(cashFlow, "NET WORKING CAPITAL CHANGE", i) ?? 0;
      if (ni != null) {
        checkFormula({
          iso, keys: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME"], period: label,
          label: "CASH FROM OPERATIONS (UCA)", statement: "cash_flow",
          expected: ni + da + wc, rendered: rowVal(cashFlow, "CASH FROM OPERATIONS (UCA)", i),
          base: totalAssets, blankWhenInputsExist: false,
        });
      }
      // Net Cash After Capex = CFO + Capital Expenditures
      const cfo = rowVal(cashFlow, "CASH FROM OPERATIONS (UCA)", i);
      const capex = rowVal(cashFlow, "Capital Expenditures", i) ?? 0;
      if (cfo != null) {
        checkFormula({
          iso, keys: ["SL_PPE_GROSS"], period: label, label: "NET CASH AFTER CAPEX", statement: "cash_flow",
          expected: cfo + capex, rendered: rowVal(cashFlow, "NET CASH AFTER CAPEX", i),
          base: totalAssets, blankWhenInputsExist: false,
        });
      }
      // Cash Available for Debt Service = Net Cash After Capex + Less: Distributions
      const ncac = rowVal(cashFlow, "NET CASH AFTER CAPEX", i);
      const distrib = rowVal(cashFlow, "Less: Distributions", i) ?? 0;
      if (ncac != null) {
        checkFormula({
          iso, keys: ["DISTRIBUTIONS"], period: label, label: "CASH AVAILABLE FOR DEBT SERVICE",
          statement: "cash_flow", expected: ncac + distrib,
          rendered: rowVal(cashFlow, "CASH AVAILABLE FOR DEBT SERVICE", i), base: totalAssets,
          blankWhenInputsExist: false,
        });
      }
    }
  }

  // ── Missing-source mapping: an uploaded line in a rendered period with no spread home ─────
  const renderedIso = new Set(periods.map((p) => p.iso));
  const unmappedKeys = new Set<string>();
  for (const [period, keyMap] of byPeriod) {
    if (!renderedIso.has(period)) continue;
    for (const [key, value] of keyMap) {
      if (value == null) continue;
      if (MAPPED_KEYS.has(key) || IGNORED_KEYS.has(key)) continue;
      if (key.startsWith("document:") || key.startsWith("PFS_")) continue;
      unmappedKeys.add(key);
      const lbl = periods.find((p) => p.iso === period)!.label;
      push({
        iso: period, keys: [key], period: lbl, statement: "balance_sheet", rowLabel: key,
        issueType: "missing_source_mapping",
        expectedValue: value, actualValue: null, difference: null, tolerance: ABS_TOL,
        severity: "warning",
        detail: `Source line "${key}" (${value}) was extracted for ${lbl} but is not mapped to any spread row.`,
      });
    }
  }

  // ── Statement truth resolver (SPEC-CLASSIC-SPREAD-STATEMENT-TRUTH-RESOLVER-1) ──────────────
  // Append the per-period arbitration findings (rejected/suspect source values, implied missing
  // components, formula mismatches) so the audit reflects the resolved truth, not just footing.
  if (input.resolve) {
    for (const { iso, label } of periods) {
      const facts = factsForPeriod(byPeriod, iso);
      for (const rf of resolveBalanceSheet(facts).findings) findings.push(toAuditFinding(rf, label, "balance_sheet"));
      for (const rf of resolveIncomeStatement1120(facts).findings) findings.push(toAuditFinding(rf, label, "income_statement"));
    }
  }

  // ── Resolver-aware de-duplication (SPEC-CLASSIC-SPREAD-AUDIT-RESOLVER-AWARE-DEDUP-1) ─────────
  // The footing checks compare the RESOLVED rendered rows against the ORIGINAL source facts, so a
  // row the resolver corrected (e.g. 2024 equity, 2025 TCA) produces a stale GENERIC blocker
  // (unreconciled_total / missing_required_value / contradictory_components) that duplicates the
  // resolver's specific rejected_source_value / missing_implied_component for the same period/row.
  // Drop the stale generic on those rows (the specific finding is the actionable one), then collapse
  // exact-duplicate findings. Real unresolved blockers on rows WITHOUT a resolver-specific finding
  // (2023 Gross Profit, uncorrected liability gaps) are untouched.
  {
    const RESOLVER_SPECIFIC = new Set<SpreadAuditIssueType>(["rejected_source_value", "missing_implied_component"]);
    const GENERIC_FOOTING = new Set<SpreadAuditIssueType>(["unreconciled_total", "missing_required_value", "contradictory_components"]);
    const cellKey = (f: SpreadAuditFinding) => `${f.period}|${f.statement}|${f.rowLabel}`;
    const resolverCells = new Set(findings.filter((f) => RESOLVER_SPECIFIC.has(f.issueType)).map(cellKey));

    const afterSuppress = findings.filter(
      (f) => !(GENERIC_FOOTING.has(f.issueType) && resolverCells.has(cellKey(f))),
    );
    const seen = new Set<string>();
    const deduped = afterSuppress.filter((f) => {
      const k = `${cellKey(f)}|${f.issueType}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // SPEC-CLASSIC-SPREAD-V12-FINAL-ACTION-DEDUPE-1: when a period has a missing_implied_component on
    // TOTAL CURRENT ASSETS, the generic TOTAL NON-CURRENT ASSETS unreconciled_total in that SAME
    // period is the OTHER half of the same incomplete asset detail (TNCA = Total Assets − Total
    // Current Assets absorbs the same gap). Downgrade it to a warning so the single actionable
    // blocker is the implied-AR REQUEST_SOURCE_DETAIL — not a separate TNCA VERIFY_SOURCE_LINE.
    // Scoped to the same period: unrelated TNCA blockers in other periods are untouched.
    const periodsWithImpliedTca = new Set(
      deduped
        .filter((f) => f.issueType === "missing_implied_component" && f.statement === "balance_sheet" && f.rowLabel === "TOTAL CURRENT ASSETS")
        .map((f) => f.period),
    );
    for (const f of deduped) {
      if (
        f.statement === "balance_sheet" &&
        f.rowLabel === "TOTAL NON-CURRENT ASSETS" &&
        f.issueType === "unreconciled_total" &&
        f.severity === "blocker" &&
        periodsWithImpliedTca.has(f.period)
      ) {
        f.severity = "warning";
        f.detail = `${f.detail} (Downgraded: stems from the same incomplete current-asset detail already flagged as a missing implied current asset for ${f.period}.)`;
      }
    }

    findings.length = 0;
    findings.push(...deduped);
  }

  // ── status + summary ──────────────────────────────────────────────────────
  const blockers = findings.filter((f) => f.severity === "blocker").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;
  const status: SpreadAuditResult["status"] = blockers > 0 ? "blocker" : warnings > 0 ? "warning" : "clean";

  const blockedCells = findings
    .filter((f) => f.severity === "blocker")
    .map((f) => ({ period: f.period, statement: f.statement, rowLabel: f.rowLabel }));

  const mappedFactKeys = new Set<string>();
  for (const [period, keyMap] of byPeriod) {
    if (!renderedIso.has(period)) continue;
    for (const [key, value] of keyMap) {
      if (value != null && MAPPED_KEYS.has(key)) mappedFactKeys.add(key);
    }
  }

  // ── Batch action summary (#4): group findings into operational source-review actions ────────
  const actions = findings.map(classifySpreadFindingAction);
  const byPeriodCount: Record<string, number> = {};
  const byDocument: Record<string, number> = {};
  const byAction: Partial<Record<SpreadFindingAction, number>> = {};
  let unresolvedActionCount = 0;
  for (const a of actions) {
    byPeriodCount[a.period] = (byPeriodCount[a.period] ?? 0) + 1;
    byAction[a.action] = (byAction[a.action] ?? 0) + 1;
    for (const d of a.documentIds) byDocument[d] = (byDocument[d] ?? 0) + 1;
    if (isUnresolvedAction(a)) unresolvedActionCount++;
  }

  return {
    status,
    findings,
    summary: {
      blockers, warnings, infos,
      periodsAudited: periods.map((p) => p.label),
      footingsChecked,
      mappedFactKeys: mappedFactKeys.size,
      unmappedFactKeys: unmappedKeys.size,
    },
    blockedCells,
    actionSummary: {
      byPeriod: byPeriodCount,
      byDocument,
      byAction,
      unresolvedActionCount,
      actions,
    },
  };
}
