/**
 * AI deal snapshot — the structured context handed to the risk and memo
 * generators by the banker analysis pipeline.
 *
 * Pure assembly (no DB, no server-only) so it is unit-testable. The pipeline
 * loads the rows and calls `buildAiDealSnapshot`.
 *
 * Why this exists: the previous builder keyed every fact by calendar year and
 * took the max year as "latest". A six-month interim income statement dated
 * 6/30/2026 therefore became "2026 revenue 684k vs 1.38M in 2025" and "net
 * income 35,746", the AI graded the deal B- with a 450 bps premium for a
 * revenue collapse that never happened, and the memo said repayment was
 * constrained while the deterministic engines had DSCR 2.53x / global 4.40x /
 * LTV 0.80. None of those canonical metrics were passed at all.
 */

export type AiSnapshotFactRow = {
  fact_key: string;
  fact_type?: string | null;
  fact_value_num: number | string | null;
  fact_period_start?: string | null;
  fact_period_end?: string | null;
  owner_type?: string | null;
};

export type AiSnapshotMetric = { value_num?: number | string | null } | null | undefined;

/** Subset of financial_snapshots.snapshot_json the generators need. */
export type AiSnapshotCanonicalSource = Partial<Record<
  | "dscr"
  | "dscr_stressed_300bps"
  | "gcf_dscr"
  | "cash_flow_available"
  | "annual_debt_service"
  | "gcf_global_cash_flow"
  | "excess_cash_flow"
  | "ltv_gross"
  | "ltv_net"
  | "collateral_gross_value"
  | "bank_loan_total"
  | "borrower_equity"
  | "revenue"
  | "ebitda"
  | "net_income"
  | "total_assets"
  | "total_liabilities"
  | "net_worth"
  | "personal_total_income"
  | "pfs_net_worth",
  AiSnapshotMetric
>> & { completeness_pct?: number | string | null; as_of_date?: string | null };

export type AiSnapshotBusinessContext = {
  legalName?: string | null;
  dba?: string | null;
  naicsCode?: string | null;
  naicsDescription?: string | null;
  businessDescription?: string | null;
  productsServices?: string | null;
  customers?: string | null;
  competitivePosition?: string | null;
  keyRisks?: string | null;
  bankerNotes?: string | null;
  website?: string | null;
  hqCity?: string | null;
  hqState?: string | null;
  yearFounded?: number | null;
  employeeCount?: number | null;
};

export type AiSnapshotManagementProfile = {
  name: string;
  title?: string | null;
  ownershipPct?: number | null;
  yearsExperience?: number | null;
  industryExperience?: string | null;
};

export type BuildAiDealSnapshotArgs = {
  dealId: string;
  borrowerName: string | null;
  entityType: string | null;
  state: string | null;
  naicsCode: string | null;
  loanAmount: number | null;
  loanPurpose: string | null;
  productType: string | null;
  occupancyType?: string | null;
  facts: AiSnapshotFactRow[];
  canonical: AiSnapshotCanonicalSource | null;
  reconciliationStatus?: "CLEAN" | "FLAGS" | "CONFLICTS" | null;
  business?: AiSnapshotBusinessContext | null;
  management?: AiSnapshotManagementProfile[];
  evidenceIndex: Array<{ docId: string; label: string; kind: "pdf" }>;
  /** Injected for tests; defaults to now. */
  today?: Date;
};

export type FiscalPeriodKind = "annual" | "interim";

export type AiInterimPeriod = {
  periodStart: string | null;
  periodEnd: string;
  months: number | null;
  revenue: number | null;
  netIncome: number | null;
  annualizedRevenue: number | null;
  annualizedNetIncome: number | null;
};

const SENTINEL_DATE_PREFIX = "1900-";
const MIN_ANNUAL_DAYS = 330;
const MS_PER_DAY = 86_400_000;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDay(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(s));
  return m ? m[0] : null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
}

/**
 * Classify one fact period. A period is annual when it spans roughly a full
 * year (start→end ≥ 330 days), or when only a fiscal-year-end (12-31) is
 * known. Anything else with a real end date is interim (YTD / quarter).
 */
export function classifyFactPeriod(
  row: Pick<AiSnapshotFactRow, "fact_period_start" | "fact_period_end">,
): FiscalPeriodKind | null {
  const end = isoDay(row.fact_period_end);
  if (!end || end.startsWith(SENTINEL_DATE_PREFIX)) return null;
  const start = isoDay(row.fact_period_start);
  if (start && !start.startsWith(SENTINEL_DATE_PREFIX) && start !== end) {
    return daysBetween(start, end) >= MIN_ANNUAL_DAYS ? "annual" : "interim";
  }
  return end.endsWith("-12-31") ? "annual" : "interim";
}

function metric(src: AiSnapshotCanonicalSource | null, key: keyof AiSnapshotCanonicalSource): number | null {
  if (!src) return null;
  const m = src[key] as AiSnapshotMetric;
  if (!m || typeof m !== "object") return null;
  return toNum(m.value_num);
}

function round(n: number | null, digits = 0): number | null {
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function buildAiDealSnapshot(args: BuildAiDealSnapshotArgs): Record<string, any> {
  const today = isoDay(args.today?.toISOString() ?? new Date().toISOString())!;

  // Entity-level facts only: the guarantor's personal return must not become
  // the business's revenue or income.
  const dealFacts = args.facts.filter(
    (f) => (f.owner_type ?? "DEAL") === "DEAL" && toNum(f.fact_value_num) !== null,
  );

  const annual: Record<number, Record<string, number>> = {};
  const interims: Array<{ start: string | null; end: string; facts: Record<string, number> }> = [];

  for (const row of dealFacts) {
    const kind = classifyFactPeriod(row);
    if (!kind) continue;
    const end = isoDay(row.fact_period_end)!;
    if (end > today) continue; // a future-dated period is never "actual"
    const value = toNum(row.fact_value_num)!;
    if (kind === "annual") {
      const year = Number(end.slice(0, 4));
      if (year < 2000 || year > 2100) continue;
      (annual[year] ??= {})[row.fact_key] ??= value;
    } else {
      const start = isoDay(row.fact_period_start);
      let bucket = interims.find((i) => i.end === end && i.start === start);
      if (!bucket) {
        bucket = { start, end, facts: {} };
        interims.push(bucket);
      }
      bucket.facts[row.fact_key] ??= value;
    }
  }

  const years = Object.keys(annual).map(Number).sort((a, b) => a - b);
  const latestYear = years[years.length - 1] ?? null;
  const latest = latestYear ? annual[latestYear] : {};

  const revenueOf = (m: Record<string, number>) =>
    m.GROSS_RECEIPTS ?? m.TOTAL_REVENUE ?? m.NET_SALES_REVENUE ?? m.REVENUE ?? null;
  const netIncomeOf = (m: Record<string, number>) =>
    m.NET_INCOME ?? m.ORDINARY_BUSINESS_INCOME ?? null;

  // Latest interim (most recent period end), annualized for comparability.
  interims.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));
  let interimPeriod: AiInterimPeriod | null = null;
  const latestInterim = interims[0];
  if (latestInterim) {
    const months = latestInterim.start
      ? Math.max(1, Math.round(daysBetween(latestInterim.start, latestInterim.end) / 30.4))
      : null;
    const rev = revenueOf(latestInterim.facts);
    const ni = netIncomeOf(latestInterim.facts);
    const factor = months ? 12 / months : null;
    interimPeriod = {
      periodStart: latestInterim.start,
      periodEnd: latestInterim.end,
      months,
      revenue: rev,
      netIncome: ni,
      annualizedRevenue: rev !== null && factor ? round(rev * factor) : null,
      annualizedNetIncome: ni !== null && factor ? round(ni * factor) : null,
    };
  }

  const c = args.canonical;
  const canonicalMetrics = {
    asOfDate: c?.as_of_date ?? null,
    completenessPct: toNum(c?.completeness_pct),
    cashFlowAvailable: metric(c, "cash_flow_available"),
    annualDebtService: metric(c, "annual_debt_service"),
    excessCashFlow: metric(c, "excess_cash_flow"),
    dscr: metric(c, "dscr"),
    dscrStressed300bps: metric(c, "dscr_stressed_300bps"),
    globalCashFlow: metric(c, "gcf_global_cash_flow"),
    globalDscr: metric(c, "gcf_dscr"),
    ltvGross: metric(c, "ltv_gross"),
    ltvNet: metric(c, "ltv_net"),
    collateralGrossValue: metric(c, "collateral_gross_value"),
    bankLoanTotal: metric(c, "bank_loan_total"),
    borrowerEquity: metric(c, "borrower_equity"),
    revenue: metric(c, "revenue"),
    ebitda: metric(c, "ebitda"),
    netIncome: metric(c, "net_income"),
    totalAssets: metric(c, "total_assets"),
    totalLiabilities: metric(c, "total_liabilities"),
    netWorth: metric(c, "net_worth"),
    guarantorPersonalIncome: metric(c, "personal_total_income"),
    guarantorNetWorth: metric(c, "pfs_net_worth"),
  };

  const notes: string[] = [
    "canonicalMetrics are the bank's deterministic underwriting results (NCADS cash flow, debt service, DSCR, global DSCR, LTV). Use them as the source of truth for repayment capacity, leverage and collateral coverage; do not re-derive coverage from raw net income.",
    "yearsAvailable / revenueTrend / netIncomeTrend contain COMPLETE fiscal years only.",
  ];
  if (interimPeriod) {
    notes.push(
      `interimPeriod is a PARTIAL-YEAR (${interimPeriod.months ?? "?"}-month) statement ending ${interimPeriod.periodEnd}. Compare it to prior years only on an annualized basis (annualizedRevenue / annualizedNetIncome); it is not a full-year decline.`,
    );
  }
  if (args.reconciliationStatus) {
    notes.push(`Cross-document reconciliation status: ${args.reconciliationStatus}.`);
  }

  return {
    dealId: args.dealId,
    borrowerName: args.borrowerName ?? "Unknown Borrower",
    entityType: args.entityType,
    state: args.state,
    naicsCode: args.naicsCode ?? args.business?.naicsCode ?? null,
    loanAmount: args.loanAmount,
    loanPurpose: args.loanPurpose,
    productType: args.productType,
    occupancyType: args.occupancyType ?? null,
    business: args.business ?? null,
    management: args.management ?? [],
    yearsAvailable: years,
    latestYear,
    latestFiscalYear: latestYear,
    grossReceipts: revenueOf(latest),
    ebitda: latest.EBITDA ?? null,
    netIncome: netIncomeOf(latest),
    depreciation: latest.DEPRECIATION ?? null,
    interestExpense: latest.INTEREST_EXPENSE ?? null,
    officerCompensation: latest.OFFICER_COMPENSATION ?? null,
    rentExpense: latest.RENT_EXPENSE ?? null,
    distributions: latest.DISTRIBUTIONS ?? latest.K1_CASH_DISTRIBUTIONS ?? null,
    totalAssets: canonicalMetrics.totalAssets ?? latest.TOTAL_ASSETS ?? null,
    totalLiabilities: canonicalMetrics.totalLiabilities ?? latest.TOTAL_LIABILITIES ?? null,
    revenueTrend: years.reduce<Record<string, number | null>>((acc, y) => {
      acc[String(y)] = revenueOf(annual[y]);
      return acc;
    }, {}),
    netIncomeTrend: years.reduce<Record<string, number | null>>((acc, y) => {
      acc[String(y)] = netIncomeOf(annual[y]);
      return acc;
    }, {}),
    interimPeriod,
    canonicalMetrics,
    reconciliationStatus: args.reconciliationStatus ?? null,
    analysisNotes: notes,
    evidenceIndex: args.evidenceIndex,
  };
}
