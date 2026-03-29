import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCovenantPackage } from "@/lib/covenants/covenantPackageBuilder";
import type { DealType } from "@/lib/covenants/covenantTypes";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  // Get risk grade
  const { data: riskRun } = await sb
    .from("ai_risk_runs")
    .select("grade")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const riskGrade = riskRun?.grade ?? "BB";

  // Get deal type + snapshot facts
  const { data: deal } = await sb.from("deals").select("entity_type").eq("id", dealId).maybeSingle();
  const dealType = mapDealType(deal?.entity_type);

  const { data: facts } = await sb
    .from("deal_financial_facts")
    .select("fact_key, value_num")
    .eq("deal_id", dealId)
    .eq("is_superseded", false);

  const fm: Record<string, number | null> = {};
  for (const f of facts ?? []) fm[f.fact_key] = f.value_num ?? null;

  try {
    const pkg = await buildCovenantPackage({
      dealId,
      riskGrade,
      dealType,
      actualDscr: fm.DSCR ?? null,
      actualLeverage: fm.DEBT_TO_EQUITY ?? null,
      actualDebtYield: fm.NOI_TTM && fm.COLLATERAL_GROSS_VALUE ? fm.NOI_TTM / fm.COLLATERAL_GROSS_VALUE : null,
      actualOccupancy: fm.OCCUPANCY_PCT ?? null,
      actualGlobalCashFlow: fm.GCF_GLOBAL_CASH_FLOW ?? null,
      loanAmount: null,
    });

    return NextResponse.json({ ok: true, package: pkg });
  } catch (err) {
    console.error("[POST covenants/generate]", err);
    return NextResponse.json({ ok: false, error: "Failed to generate" }, { status: 500 });
  }
}

function mapDealType(entityType: string | null | undefined): DealType {
  if (!entityType) return "operating_company";
  const lower = entityType.toLowerCase();
  if (lower.includes("real_estate") || lower.includes("cre")) return "real_estate";
  if (lower.includes("mixed")) return "mixed_use";
  return "operating_company";
}
