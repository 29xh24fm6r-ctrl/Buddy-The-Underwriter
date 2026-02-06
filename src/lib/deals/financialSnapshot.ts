import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";
import type { RentRollRow } from "@/lib/financialSpreads/types";
import {
  buildEmptyMetric,
  buildSnapshotFromFacts,
  type DealFinancialSnapshotV1,
  type MetricSpec,
  type SnapshotMetricValue,
  type MinimalFact,
} from "@/lib/deals/financialSnapshotCore";

function toIsoDatePrefix(s: unknown): string | null {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

function parseIsoUTC(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d));
}

function computeWaltYearsFromRentRoll(args: {
  rows: RentRollRow[];
  asOfDate: string;
}): SnapshotMetricValue {
  // Weighted average remaining lease term (years), weighted by annual rent.
  let weightedSum = 0;
  let weightTotal = 0;

  const asOf = parseIsoUTC(args.asOfDate);
  if (!asOf) return buildEmptyMetric();

  for (const r of args.rows) {
    if (String(r.as_of_date) !== args.asOfDate) continue;
    if (r.occupancy_status !== "OCCUPIED") continue;
    const leaseEnd = toIsoDatePrefix(r.lease_end);
    if (!leaseEnd) continue;

    const end = parseIsoUTC(leaseEnd);
    if (!end) continue;

    const diffDays = (end.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24);
    const years = Math.max(0, diffDays / 365.25);

    const monthly = typeof (r as any).monthly_rent === "number" ? Number((r as any).monthly_rent) : null;
    const annual = typeof (r as any).annual_rent === "number" ? Number((r as any).annual_rent) : monthly !== null ? monthly * 12 : null;
    if (annual === null || !Number.isFinite(annual)) continue;

    weightedSum += years * annual;
    weightTotal += annual;
  }

  if (!weightTotal) return buildEmptyMetric();

  const value = weightedSum / weightTotal;
  return {
    value_num: value,
    value_text: null,
    as_of_date: args.asOfDate,
    confidence: 0.85,
    source_type: "SPREAD",
    source_ref: `deal_rent_roll_rows:${args.asOfDate}`,
    provenance: {
      source_type: "SPREAD",
      source_ref: `deal_rent_roll_rows:${args.asOfDate}`,
      as_of_date: args.asOfDate,
      extractor: "financialSnapshot:walt_years:v1",
      confidence: 0.85,
    },
  };
}

function latestAsOfDateFromRentRollRows(rows: RentRollRow[]): string | null {
  let out: string | null = null;
  for (const r of rows) {
    const d = toIsoDatePrefix((r as any).as_of_date);
    if (!d) continue;
    if (!out || d > out) out = d;
  }
  return out;
}

function metricSpecsV1(): MetricSpec[] {
  return [
    { metric: "total_income_ttm", fact_type: CANONICAL_FACTS.TOTAL_INCOME_TTM.fact_type, fact_key: CANONICAL_FACTS.TOTAL_INCOME_TTM.fact_key },
    { metric: "noi_ttm", fact_type: CANONICAL_FACTS.NOI_TTM.fact_type, fact_key: CANONICAL_FACTS.NOI_TTM.fact_key },
    { metric: "opex_ttm", fact_type: CANONICAL_FACTS.OPEX_TTM.fact_type, fact_key: CANONICAL_FACTS.OPEX_TTM.fact_key },

    { metric: "cash_flow_available", fact_type: CANONICAL_FACTS.CASH_FLOW_AVAILABLE.fact_type, fact_key: CANONICAL_FACTS.CASH_FLOW_AVAILABLE.fact_key },
    { metric: "annual_debt_service", fact_type: CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_type, fact_key: CANONICAL_FACTS.ANNUAL_DEBT_SERVICE.fact_key },
    { metric: "excess_cash_flow", fact_type: CANONICAL_FACTS.EXCESS_CASH_FLOW.fact_type, fact_key: CANONICAL_FACTS.EXCESS_CASH_FLOW.fact_key },
    { metric: "dscr", fact_type: CANONICAL_FACTS.DSCR.fact_type, fact_key: CANONICAL_FACTS.DSCR.fact_key },
    { metric: "dscr_stressed_300bps", fact_type: CANONICAL_FACTS.DSCR_STRESSED_300BPS.fact_type, fact_key: CANONICAL_FACTS.DSCR_STRESSED_300BPS.fact_key },

    { metric: "collateral_gross_value", fact_type: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_type, fact_key: CANONICAL_FACTS.COLLATERAL_GROSS_VALUE.fact_key },
    { metric: "collateral_net_value", fact_type: CANONICAL_FACTS.COLLATERAL_NET_VALUE.fact_type, fact_key: CANONICAL_FACTS.COLLATERAL_NET_VALUE.fact_key },
    { metric: "collateral_discounted_value", fact_type: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_VALUE.fact_type, fact_key: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_VALUE.fact_key },
    { metric: "collateral_coverage", fact_type: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_COVERAGE.fact_type, fact_key: CANONICAL_FACTS.COLLATERAL_DISCOUNTED_COVERAGE.fact_key },
    { metric: "ltv_gross", fact_type: CANONICAL_FACTS.LTV_GROSS.fact_type, fact_key: CANONICAL_FACTS.LTV_GROSS.fact_key },
    { metric: "ltv_net", fact_type: CANONICAL_FACTS.LTV_NET.fact_type, fact_key: CANONICAL_FACTS.LTV_NET.fact_key },

    { metric: "in_place_rent_mo", fact_type: CANONICAL_FACTS.IN_PLACE_RENT_MO.fact_type, fact_key: CANONICAL_FACTS.IN_PLACE_RENT_MO.fact_key },
    { metric: "occupancy_pct", fact_type: CANONICAL_FACTS.OCCUPANCY_PCT.fact_type, fact_key: CANONICAL_FACTS.OCCUPANCY_PCT.fact_key },
    { metric: "vacancy_pct", fact_type: CANONICAL_FACTS.VACANCY_PCT.fact_type, fact_key: CANONICAL_FACTS.VACANCY_PCT.fact_key },

    { metric: "total_project_cost", fact_type: CANONICAL_FACTS.TOTAL_PROJECT_COST.fact_type, fact_key: CANONICAL_FACTS.TOTAL_PROJECT_COST.fact_key },
    { metric: "borrower_equity", fact_type: CANONICAL_FACTS.BORROWER_EQUITY.fact_type, fact_key: CANONICAL_FACTS.BORROWER_EQUITY.fact_key },
    { metric: "borrower_equity_pct", fact_type: CANONICAL_FACTS.BORROWER_EQUITY_PCT.fact_type, fact_key: CANONICAL_FACTS.BORROWER_EQUITY_PCT.fact_key },
    { metric: "bank_loan_total", fact_type: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_type, fact_key: CANONICAL_FACTS.BANK_LOAN_TOTAL.fact_key },

    // Balance sheet metrics
    { metric: "total_assets", fact_type: CANONICAL_FACTS.TOTAL_ASSETS.fact_type, fact_key: CANONICAL_FACTS.TOTAL_ASSETS.fact_key },
    { metric: "total_liabilities", fact_type: CANONICAL_FACTS.TOTAL_LIABILITIES.fact_type, fact_key: CANONICAL_FACTS.TOTAL_LIABILITIES.fact_key },
    { metric: "net_worth", fact_type: CANONICAL_FACTS.NET_WORTH.fact_type, fact_key: CANONICAL_FACTS.NET_WORTH.fact_key },

    // Tax return / global cash flow metrics
    { metric: "gross_receipts", fact_type: CANONICAL_FACTS.GROSS_RECEIPTS.fact_type, fact_key: CANONICAL_FACTS.GROSS_RECEIPTS.fact_key },
    { metric: "depreciation_addback", fact_type: CANONICAL_FACTS.DEPRECIATION_ADDBACK.fact_type, fact_key: CANONICAL_FACTS.DEPRECIATION_ADDBACK.fact_key },
    { metric: "global_cash_flow", fact_type: CANONICAL_FACTS.GLOBAL_CASH_FLOW.fact_type, fact_key: CANONICAL_FACTS.GLOBAL_CASH_FLOW.fact_key },

    // Personal income / PFS / GCF metrics
    { metric: "personal_total_income", fact_type: CANONICAL_FACTS.PERSONAL_TOTAL_INCOME.fact_type, fact_key: CANONICAL_FACTS.PERSONAL_TOTAL_INCOME.fact_key },
    { metric: "pfs_total_assets", fact_type: CANONICAL_FACTS.PFS_TOTAL_ASSETS.fact_type, fact_key: CANONICAL_FACTS.PFS_TOTAL_ASSETS.fact_key },
    { metric: "pfs_total_liabilities", fact_type: CANONICAL_FACTS.PFS_TOTAL_LIABILITIES.fact_type, fact_key: CANONICAL_FACTS.PFS_TOTAL_LIABILITIES.fact_key },
    { metric: "pfs_net_worth", fact_type: CANONICAL_FACTS.PFS_NET_WORTH.fact_type, fact_key: CANONICAL_FACTS.PFS_NET_WORTH.fact_key },
    { metric: "gcf_global_cash_flow", fact_type: CANONICAL_FACTS.GCF_GLOBAL_CASH_FLOW.fact_type, fact_key: CANONICAL_FACTS.GCF_GLOBAL_CASH_FLOW.fact_key },
    { metric: "gcf_dscr", fact_type: CANONICAL_FACTS.GCF_DSCR.fact_type, fact_key: CANONICAL_FACTS.GCF_DSCR.fact_key },
  ];
}

export async function buildDealFinancialSnapshot(dealId: string): Promise<DealFinancialSnapshotV1> {
  const bankId = await getCurrentBankId();
  return buildDealFinancialSnapshotForBank({ dealId, bankId });
}

export async function buildDealFinancialSnapshotForBank(args: {
  dealId: string;
  bankId: string;
}): Promise<DealFinancialSnapshotV1> {
  const bankId = args.bankId;
  const sb = supabaseAdmin();

  const factsRes = await (sb as any)
    .from("deal_financial_facts")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("bank_id", bankId);

  if (factsRes.error) {
    throw new Error(`deal_financial_facts_select_failed:${factsRes.error.message}`);
  }

  const facts = (factsRes.data ?? []) as MinimalFact[];

  const rrRes = await (sb as any)
    .from("deal_rent_roll_rows")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("bank_id", bankId);

  if (rrRes.error) {
    throw new Error(`deal_rent_roll_rows_select_failed:${rrRes.error.message}`);
  }

  const rrRows = (rrRes.data ?? []) as RentRollRow[];
  const rrAsOf = latestAsOfDateFromRentRollRows(rrRows);
  const waltYears = rrAsOf ? computeWaltYearsFromRentRoll({ rows: rrRows, asOfDate: rrAsOf }) : buildEmptyMetric();

  return buildSnapshotFromFacts({ facts, metricSpecs: metricSpecsV1(), waltYears });
}
