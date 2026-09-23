// src/app/api/borrower/portal/[token]/base-year/route.ts
// Phase 85-BPG-B — Load base-year financial facts for the live projection dashboard.
// Read-only: shares accepted history, opening balances and costs with the package.

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { loadPackageProjectionBasis } from "@/lib/modelEngine/packageProjectionBasis";
import { assessNewBusinessRisk, detectNewBusinessFromFacts } from "@/lib/sba/newBusinessProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  try {
    const basis = await loadPackageProjectionBasis(ctx.dealId, ctx.bankId);
    const { baseYear, bsBase, useOfProceeds, preOpening, authority, deal, latest } = basis;
    const age = detectNewBusinessFromFacts(authority.facts.map(f => ({ fact_key: f.fact_key,
      value_numeric: f.fact_value_num == null ? null : Number(f.fact_value_num), value_text: f.fact_value_text ?? null })));
    const risk = assessNewBusinessRisk({ yearsInBusiness: preOpening ? 0 : age.yearsInBusiness,
      monthsInBusiness: preOpening ? 0 : age.monthsInBusiness, hasBusinessPlan: true,
      managementYearsInIndustry: null, loanType: deal.deal_type ?? "SBA", loanAmount: deal.loan_amount });
    if (!risk.flags.isNewBusiness && (!latest || latest.income.revenue == null || latest.cashflow.ebitda == null || latest.balance.cash == null)) throw new Error("financial_basis_unavailable");
    return NextResponse.json({ ok: true,
      baseYear: { ...baseYear, existingDebtServiceAnnual: baseYear.totalDebtService },
      projectionBasis: { baseYear, openingBalance: bsBase, useOfProceeds, projectedDscrThreshold: risk.flags.projectedDscrThreshold },
      hasData: preOpening || baseYear.revenue > 0,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "financial_basis_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
