import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import {
  isModelEngineV2Enabled,
  buildFinancialModel,
  evaluateMetricGraph,
  computeCapitalModel,
  evaluateRisk,
  deterministicHash,
  loadMetricRegistry,
  saveModelSnapshot,
} from "@/lib/modelEngine";
import type { FactInput, ModelPreviewResult } from "@/lib/modelEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    // Feature flag check
    if (!isModelEngineV2Enabled()) {
      return NextResponse.json(
        { ok: false, error: "model_engine_v2_disabled" },
        { status: 404 },
      );
    }

    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // 1. Load all financial facts for this deal
    const { data: rawFacts, error: factsErr } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId);

    if (factsErr) {
      return NextResponse.json(
        { ok: false, error: `facts_load_failed: ${factsErr.message}` },
        { status: 500 },
      );
    }

    const facts: FactInput[] = (rawFacts ?? []).map((f: any) => ({
      fact_type: f.fact_type,
      fact_key: f.fact_key,
      fact_value_num: f.fact_value_num !== null ? Number(f.fact_value_num) : null,
      fact_period_end: f.fact_period_end,
      confidence: f.confidence !== null ? Number(f.confidence) : null,
    }));

    // 2. Build financial model
    const financialModel = buildFinancialModel(dealId, facts);

    // 3. Load metric registry
    const metricDefs = await loadMetricRegistry(sb, "v1");

    // 4. Build base values from latest period for metric evaluation
    const baseValues: Record<string, number | null> = {};
    if (financialModel.periods.length > 0) {
      const latest = financialModel.periods[financialModel.periods.length - 1];

      // Map period fields to metric keys
      if (latest.income.revenue !== undefined) baseValues["REVENUE"] = latest.income.revenue;
      if (latest.income.cogs !== undefined) baseValues["COGS"] = latest.income.cogs;
      if (latest.income.netIncome !== undefined) baseValues["NET_INCOME"] = latest.income.netIncome;
      if (latest.income.operatingExpenses !== undefined) baseValues["OPERATING_EXPENSES"] = latest.income.operatingExpenses;
      if (latest.income.revenue !== undefined && latest.income.cogs !== undefined) {
        baseValues["GROSS_PROFIT"] = latest.income.revenue - latest.income.cogs;
      }

      if (latest.balance.totalAssets !== undefined) baseValues["TOTAL_ASSETS"] = latest.balance.totalAssets;
      if (latest.balance.totalLiabilities !== undefined) baseValues["TOTAL_LIABILITIES"] = latest.balance.totalLiabilities;
      if (latest.balance.equity !== undefined) baseValues["EQUITY"] = latest.balance.equity;
      if (latest.balance.shortTermDebt !== undefined || latest.balance.longTermDebt !== undefined) {
        baseValues["TOTAL_DEBT"] = (latest.balance.shortTermDebt ?? 0) + (latest.balance.longTermDebt ?? 0);
      }

      // Current assets/liabilities for current ratio
      const currentAssets = (latest.balance.cash ?? 0) + (latest.balance.accountsReceivable ?? 0) + (latest.balance.inventory ?? 0);
      if (currentAssets > 0) baseValues["CURRENT_ASSETS"] = currentAssets;
      // Use short-term debt as proxy for current liabilities
      if (latest.balance.shortTermDebt !== undefined) baseValues["CURRENT_LIABILITIES"] = latest.balance.shortTermDebt;

      if (latest.cashflow.ebitda !== undefined) baseValues["EBITDA"] = latest.cashflow.ebitda;
      if (latest.cashflow.cfads !== undefined) baseValues["CFADS"] = latest.cashflow.cfads;
      if (latest.income.interest !== undefined) baseValues["DEBT_SERVICE"] = latest.income.interest;
    }

    // 5. Evaluate metrics
    const computedMetrics = evaluateMetricGraph(metricDefs, baseValues);

    // 6. Capital model
    const capitalModel = computeCapitalModel(financialModel);

    // 7. Risk engine
    const riskResult = evaluateRisk(computedMetrics);

    // 8. Hashes for audit trail
    const metricRegistryHash = deterministicHash(metricDefs);
    const financialModelHash = deterministicHash(financialModel);
    const computedAt = new Date().toISOString();

    // 9. Always persist snapshot for audit trail
    let snapshotId: string | null = null;
    {
      const saveResult = await saveModelSnapshot(
        sb,
        {
          dealId,
          bankId: access.bankId,
          modelVersion: "v1",
          metricRegistryHash,
          financialModelHash,
          calculatedAt: computedAt,
        },
        computedMetrics,
        riskResult.flags,
      );
      snapshotId = saveResult.id ?? null;
    }

    const result: ModelPreviewResult = {
      financialModel,
      computedMetrics,
      riskFlags: riskResult.flags,
      capitalModel,
      meta: {
        modelVersion: "v1",
        metricRegistryHash,
        financialModelHash,
        periodCount: financialModel.periods.length,
        computedAt,
      },
    };

    return NextResponse.json({
      ok: true,
      ...result,
      ...(snapshotId ? { snapshotId } : {}),
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/model-v2/preview]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
