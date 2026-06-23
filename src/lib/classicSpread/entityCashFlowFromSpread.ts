/**
 * SPEC-CLASSIC-SPREAD-GCF-ENTITY-CASH-FLOW-COMPUTE-1 — compute entity cash flow + global DSCR for the
 * Global Cash Flow section from the ALREADY-RENDERED classic spread rows, without inventing source data.
 *
 * The pipeline does not always materialize a GCF / entity-cash-flow fact (e.g. OmniCare, where the only
 * candidate was a sentinel-period CASH_FLOW_AVAILABLE the certification gate correctly suppressed). When
 * that happens the GCF page reads "Entity data not yet computed". This module derives entity cash flow
 * from the rendered annual income statement instead — the SAME rows the banker already sees — following
 * the GCF methodology already printed on the page:
 *
 *   NCADS Source: Standard  ->  EBITDA  ->  Ordinary Business Income / Net Income
 *
 * Pure: no DB, no canonical VM, no reconcileFinancialFacts, no new facts. It only reads the rendered
 * `incomeStatement` rows + `periods` that the loader already built, and the existing proposed annual
 * debt service on the section. Fail-closed: if there is no usable annual period the section is returned
 * unchanged (GCF stays blocked / "not computed").
 */

import type { FinancialRow, GlobalCashFlowSection, StatementPeriod } from "./types";

export type EntityCashFlowBasis = "EBITDA" | "NET_PROFIT";

export type EntityCashFlowComputation = {
  /** computed entity cash flow available for debt service, or null when no annual row supports it */
  entityCashFlowAvailable: number | null;
  /** which rendered row backed it (EBITDA preferred, then NET PROFIT = OBI/NI) */
  basis: EntityCashFlowBasis | null;
  /** the source annual period label (e.g. "2025"), for honest provenance on the PDF */
  sourcePeriodLabel: string | null;
};

/** Income-statement row labels as built by classicSpreadLoader.buildIncomeStatementRows. */
const EBITDA_ROW_LABEL = "EBITDA";
const NET_PROFIT_ROW_LABEL = "NET PROFIT"; // NET_INCOME, falling back to ORDINARY_BUSINESS_INCOME

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A debt-service denominator is only usable when it is a finite, strictly-positive number. */
export function isValidProposedDebtService(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function parseYear(p: StatementPeriod): number {
  const fromDate = p.date?.match(/(\d{4})/)?.[1];
  if (fromDate) return parseInt(fromDate, 10);
  const fromLabel = p.label?.match(/(\d{4})/)?.[1];
  return fromLabel ? parseInt(fromLabel, 10) : -Infinity;
}

/**
 * Compute entity cash flow from the rendered income statement using the latest usable ANNUAL period
 * (never an interim / YTD column). Within the chosen period, prefer EBITDA, then NET PROFIT (OBI/NI).
 * If the latest annual period supports neither, fall back to the next-latest annual period.
 */
export function computeEntityCashFlowFromSpread(args: {
  incomeStatement: FinancialRow[];
  periods: StatementPeriod[];
}): EntityCashFlowComputation {
  const { incomeStatement, periods } = args;
  const empty: EntityCashFlowComputation = { entityCashFlowAvailable: null, basis: null, sourcePeriodLabel: null };

  const ebitdaRow = incomeStatement.find((r) => r.label === EBITDA_ROW_LABEL);
  const netProfitRow = incomeStatement.find((r) => r.label === NET_PROFIT_ROW_LABEL);
  if (!ebitdaRow && !netProfitRow) return empty;

  const annual = periods
    .map((p, index) => ({ p, index, year: parseYear(p) }))
    .filter((x) => x.p.stmtType === "Annual")
    .sort((a, b) => b.year - a.year); // latest annual first

  for (const { p, index } of annual) {
    const ebitda = num(ebitdaRow?.values[index]);
    if (ebitda != null) {
      return { entityCashFlowAvailable: ebitda, basis: "EBITDA", sourcePeriodLabel: p.label };
    }
    const netProfit = num(netProfitRow?.values[index]);
    if (netProfit != null) {
      return { entityCashFlowAvailable: netProfit, basis: "NET_PROFIT", sourcePeriodLabel: p.label };
    }
  }
  return empty;
}

/**
 * Return a GCF section with entity cash flow, global cash flow available, and global DSCR computed from
 * the rendered annual rows when the pipeline did not materialize an entity cash flow value.
 *
 *  - Only computes when `entityCashFlowAvailable` is currently null (a materialized value is left alone).
 *  - Global Cash Flow Available = computed entity cash flow + supported sponsor personal-income contribution.
 *  - Global DSCR is computed ONLY when the numerator is numeric AND the proposed annual debt service is a
 *    valid positive number; otherwise it stays unavailable (never Infinity / a misleading ratio).
 *  - Marks the result as computed/preliminary so certification + PDF present it honestly.
 *
 * Pure — returns a new section; never mutates the input.
 */
export function applyComputedEntityCashFlow(
  section: GlobalCashFlowSection,
  incomeStatement: FinancialRow[],
  periods: StatementPeriod[],
): GlobalCashFlowSection {
  // A materialized entity cash flow is authoritative — never override it with a derived figure.
  if (section.entityCashFlowAvailable != null) return section;

  const ecf = computeEntityCashFlowFromSpread({ incomeStatement, periods });
  if (ecf.entityCashFlowAvailable == null) return section; // no supported annual row → stay blocked

  const personalContribution = section.sponsors.reduce(
    (sum, s) => sum + (num(s.personalCashAvailable) ?? 0),
    0,
  );
  const globalCashFlow = ecf.entityCashFlowAvailable + personalContribution;

  const ads = section.proposedAnnualDebtService;
  const globalDscr = isValidProposedDebtService(ads) && Number.isFinite(globalCashFlow)
    ? globalCashFlow / ads
    : null;

  let coverageStatus: GlobalCashFlowSection["coverageStatus"] = "UNKNOWN";
  if (globalDscr != null) {
    if (globalDscr >= 1.25) coverageStatus = "ADEQUATE";
    else if (globalDscr >= 1.0) coverageStatus = "TIGHT";
    else coverageStatus = "DEFICIT";
  }

  return {
    ...section,
    entityCashFlowAvailable: ecf.entityCashFlowAvailable,
    globalCashFlow,
    globalDscr,
    coverageStatus,
    entityCashFlowComputed: true,
    entityCashFlowBasis: ecf.basis,
    entityCashFlowSourcePeriod: ecf.sourcePeriodLabel,
  };
}
