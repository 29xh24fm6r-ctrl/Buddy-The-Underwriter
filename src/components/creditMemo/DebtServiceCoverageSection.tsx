import "server-only";

import React from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeDscrLikeRatio, dscrDisplayLabel } from "@/lib/financialFacts/dscrRegistry";

// ── Fact keys we care about ──────────────────────────────────────────────

const DSCR_FACT_KEYS = [
  "REVENUE",
  "TOTAL_REVENUE",
  "GROSS_REVENUE",
  "NET_INCOME",
  "EBITDA",
  "DEPRECIATION",
  "AMORTIZATION",
  "INTEREST_EXPENSE",
  // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: the headline DSCR numerator is the institutional
  // CF_NCADS (mirrored to CASH_FLOW_AVAILABLE), NOT EBITDA.
  "CF_NCADS",
  "CASH_FLOW_AVAILABLE",
  "ANNUAL_DEBT_SERVICE",
  "ANNUAL_DEBT_SERVICE_PROPOSED",
  "ANNUAL_DEBT_SERVICE_EXISTING",
  "DSCR",
  "DSCR_STRESSED_300BPS",
  "PROPOSED_LOAN_COVERAGE",
  "GCF_DSCR",
  "GCF_CASH_AVAILABLE",
  "GCF_TOTAL_OBLIGATIONS",
] as const;

type FactMap = Record<string, number | null>;

// ── Helpers ──────────────────────────────────────────────────────────────

function fmt(v: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "\u2014";
  if (Math.abs(v) >= 1000) {
    return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtRatio(v: number | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "\u2014";
  return v.toFixed(2) + "x";
}

// ── Component ────────────────────────────────────────────────────────────

export default async function DebtServiceCoverageSection({
  dealId,
}: {
  dealId: string;
}) {
  const sb = supabaseAdmin();

  // ACTIVATION Fix #5: Filter superseded/rejected facts to align with canonical memo
  const { data: facts } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_type, fact_period_end")
    .eq("deal_id", dealId)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected")
    .in("fact_key", [...DSCR_FACT_KEYS])
    .order("fact_period_end", { ascending: false });

  if (!facts || facts.length === 0) return null;

  // Take the most recent value for each key
  const latest: FactMap = {};
  for (const f of facts as Array<{ fact_key: string; fact_value_num: number | null }>) {
    if (!(f.fact_key in latest) && f.fact_value_num !== null) {
      latest[f.fact_key] = f.fact_value_num;
    }
  }

  // Derive values
  const revenue = latest.REVENUE ?? latest.TOTAL_REVENUE ?? latest.GROSS_REVENUE ?? null;
  const netIncome = latest.NET_INCOME ?? null;
  const ebitda = latest.EBITDA ?? null;
  const depreciation = latest.DEPRECIATION ?? null;
  const amortization = latest.AMORTIZATION ?? null;
  const interestExpense = latest.INTEREST_EXPENSE ?? null;

  // Compute EBITDA from components if not directly available
  const derivedEbitda =
    ebitda ??
    (netIncome !== null
      ? netIncome +
        (interestExpense ?? 0) +
        (depreciation ?? 0) +
        (amortization ?? 0)
      : null);

  // SPEC-TIER5-FINANCIAL-DEFINITION-UNIFICATION-1: canonical headline DSCR = CF_NCADS / TOTAL annual
  // debt service. NEVER derive DSCR from EBITDA, and never silently substitute proposed-only debt
  // service and still call it DSCR — coverage of the proposed loan only is a distinct, separately
  // labeled metric (Proposed Loan Coverage).
  const ncads = latest.CF_NCADS ?? latest.CASH_FLOW_AVAILABLE ?? null;
  const totalDebtService = latest.ANNUAL_DEBT_SERVICE ?? null;
  const proposedDebtService = latest.ANNUAL_DEBT_SERVICE_PROPOSED ?? null;
  const existingDebtService = latest.ANNUAL_DEBT_SERVICE_EXISTING ?? null;

  const dscr = latest.DSCR ?? computeDscrLikeRatio(ncads, totalDebtService);
  const proposedLoanCoverage =
    latest.PROPOSED_LOAN_COVERAGE ?? computeDscrLikeRatio(ncads, proposedDebtService);

  const dscrStressed = latest.DSCR_STRESSED_300BPS ?? null;
  const gcfDscr = latest.GCF_DSCR ?? null;
  const gcfCashAvailable = latest.GCF_CASH_AVAILABLE ?? null;
  const gcfTotalObligations = latest.GCF_TOTAL_OBLIGATIONS ?? null;

  // Need at least EBITDA or debt service to render something meaningful
  if (
    derivedEbitda === null &&
    totalDebtService === null &&
    proposedDebtService === null &&
    dscr === null
  ) {
    return null;
  }

  type Row = { label: string; value: string; bold?: boolean; indent?: boolean };
  const rows: Row[] = [];

  // Income / EBITDA section
  if (revenue !== null) rows.push({ label: "Revenue", value: fmt(revenue) });
  if (netIncome !== null) rows.push({ label: "Net Income", value: fmt(netIncome) });
  if (depreciation !== null) rows.push({ label: "Add: Depreciation", value: fmt(depreciation), indent: true });
  if (amortization !== null) rows.push({ label: "Add: Amortization", value: fmt(amortization), indent: true });
  if (interestExpense !== null) rows.push({ label: "Add: Interest Expense", value: fmt(interestExpense), indent: true });
  if (derivedEbitda !== null) rows.push({ label: "EBITDA", value: fmt(derivedEbitda), bold: true });

  // Debt service section
  if (existingDebtService !== null) rows.push({ label: "Existing Debt Service", value: fmt(existingDebtService) });
  if (proposedDebtService !== null) rows.push({ label: "Proposed Debt Service", value: fmt(proposedDebtService) });
  if (totalDebtService !== null) rows.push({ label: "Total Annual Debt Service", value: fmt(totalDebtService), bold: true });

  // Coverage ratios — each distinctly labeled from the registry (no bare/mislabeled DSCR).
  if (dscr !== null) rows.push({ label: dscrDisplayLabel("DSCR"), value: fmtRatio(dscr), bold: true });
  if (dscrStressed !== null) rows.push({ label: dscrDisplayLabel("DSCR_STRESSED_300BPS"), value: fmtRatio(dscrStressed) });
  if (proposedLoanCoverage !== null) rows.push({ label: dscrDisplayLabel("PROPOSED_LOAN_COVERAGE"), value: fmtRatio(proposedLoanCoverage) });

  // Global cash flow section
  if (gcfCashAvailable !== null || gcfTotalObligations !== null || gcfDscr !== null) {
    rows.push({ label: "", value: "" }); // spacer
    if (gcfCashAvailable !== null) rows.push({ label: "Global Cash Available for Debt Service", value: fmt(gcfCashAvailable) });
    if (gcfTotalObligations !== null) rows.push({ label: "Global Total Obligations", value: fmt(gcfTotalObligations) });
    if (gcfDscr !== null) rows.push({ label: dscrDisplayLabel("GCF_DSCR"), value: fmtRatio(gcfDscr), bold: true });
  }

  if (rows.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
        <div className="text-xs font-semibold text-gray-700">
          Debt Service Coverage Analysis
        </div>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
              Item
            </th>
            <th className="text-right px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            if (row.label === "" && row.value === "") {
              return (
                <tr key={i}>
                  <td colSpan={2} className="h-2 border-b border-gray-50" />
                </tr>
              );
            }
            return (
              <tr key={i} className={row.bold ? "font-bold bg-gray-50" : ""}>
                <td className={`px-3 py-1 border-b border-gray-50 text-gray-700 ${row.indent ? "pl-6" : ""}`}>
                  {row.label}
                </td>
                <td className="px-3 py-1 text-right tabular-nums border-b border-gray-50">
                  {row.value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
