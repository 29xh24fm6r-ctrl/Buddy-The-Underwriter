// src/app/api/borrower/portal/[token]/base-year/route.ts
// Phase 85-BPG-B — Load base-year financial facts for the live projection dashboard.
// Read-only: pulls from deal_financial_facts with a fallback chain (matches
// sbaPackageOrchestrator's key resolution order).

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Fact = { fact_key: string; fact_value_num: number | string | null };

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

  const sb = supabaseAdmin();

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num")
    .eq("deal_id", ctx.dealId)
    .in("fact_key", [
      "TOTAL_REVENUE_IS",
      "TOTAL_REVENUE",
      "TOTAL_COGS_IS",
      "COST_OF_GOODS_SOLD",
      "COGS",
      "TOTAL_OPERATING_EXPENSES_IS",
      "TOTAL_OPERATING_EXPENSES",
      "NET_INCOME",
      "EBITDA",
      "DEPRECIATION_IS",
      "DEPRECIATION",
      "INTEREST_EXPENSE",
      "TOTAL_TAX",
      "ADS",
    ])
    .order("created_at", { ascending: false });

  const rows: Fact[] = (facts as Fact[] | null) ?? [];

  const getFact = (...keys: string[]): number => {
    for (const key of keys) {
      const found = rows.find((f) => f.fact_key === key);
      if (found?.fact_value_num != null) return Number(found.fact_value_num);
    }
    return 0;
  };

  const revenue = getFact("TOTAL_REVENUE_IS", "TOTAL_REVENUE");
  const cogs = getFact("TOTAL_COGS_IS", "COST_OF_GOODS_SOLD", "COGS");
  const operatingExpenses = getFact(
    "TOTAL_OPERATING_EXPENSES_IS",
    "TOTAL_OPERATING_EXPENSES",
  );
  const depreciation = getFact("DEPRECIATION_IS", "DEPRECIATION");
  const netIncome = getFact("NET_INCOME");
  const interestExpense = getFact("INTEREST_EXPENSE");
  const totalTax = getFact("TOTAL_TAX");
  const existingDebtServiceAnnual = getFact("ADS");

  // Derive EBITDA from net income + I + D + A if not directly stored.
  let ebitda = getFact("EBITDA");
  if (ebitda === 0 && netIncome !== 0) {
    ebitda = netIncome + interestExpense + depreciation + totalTax;
  }

  return NextResponse.json({
    ok: true,
    baseYear: {
      revenue,
      cogs,
      operatingExpenses,
      ebitda,
      depreciation,
      netIncome,
      existingDebtServiceAnnual,
    },
    hasData: revenue > 0,
  });
}
