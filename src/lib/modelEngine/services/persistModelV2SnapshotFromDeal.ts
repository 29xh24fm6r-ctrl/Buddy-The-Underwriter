import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  evaluateMetricGraph,
  computeCapitalModel,
  evaluateRisk,
  deterministicHash,
  loadMetricRegistry,
  saveModelSnapshot,
} from "@/lib/modelEngine";
import type { FinancialModel, RiskFlag } from "@/lib/modelEngine";

/**
 * Shared service: compute metrics + persist a V2 model snapshot.
 *
 * Used by both:
 *   - /api/deals/[dealId]/model-v2/preview (primary computation route)
 *   - /api/deals/[dealId]/spreads/moodys   (shadow snapshot on spread view)
 *
 * Returns the snapshotId and computed metrics, or null on failure.
 * Never throws — callers use fire-and-forget.
 */
export async function persistModelV2SnapshotFromDeal(opts: {
  dealId: string;
  bankId: string;
  model: FinancialModel;
}): Promise<{
  snapshotId: string | null;
  computedMetrics: Record<string, number | null>;
  riskFlags: RiskFlag[];
} | null> {
  try {
    const sb = supabaseAdmin();
    const { dealId, bankId, model } = opts;

    // 1. Load metric registry
    const metricDefs = await loadMetricRegistry(sb, "v1");

    // 2. Build base values from latest period
    const baseValues: Record<string, number | null> = {};
    if (model.periods.length > 0) {
      const latest = model.periods[model.periods.length - 1];

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

      const currentAssets = (latest.balance.cash ?? 0) + (latest.balance.accountsReceivable ?? 0) + (latest.balance.inventory ?? 0);
      if (currentAssets > 0) baseValues["CURRENT_ASSETS"] = currentAssets;
      if (latest.balance.shortTermDebt !== undefined) baseValues["CURRENT_LIABILITIES"] = latest.balance.shortTermDebt;

      if (latest.cashflow.ebitda !== undefined) baseValues["EBITDA"] = latest.cashflow.ebitda;
      if (latest.cashflow.cfads !== undefined) baseValues["CFADS"] = latest.cashflow.cfads;
      if (latest.income.interest !== undefined) baseValues["DEBT_SERVICE"] = latest.income.interest;
    }

    // 3. Evaluate metrics
    const computedMetrics = evaluateMetricGraph(metricDefs, baseValues);

    // 4. Risk engine
    const riskResult = evaluateRisk(computedMetrics);

    // 5. Hashes
    const metricRegistryHash = deterministicHash(metricDefs);
    const financialModelHash = deterministicHash(model);
    const computedAt = new Date().toISOString();

    // 6. Persist
    const saveResult = await saveModelSnapshot(
      sb,
      {
        dealId,
        bankId,
        modelVersion: "v1",
        metricRegistryHash,
        financialModelHash,
        calculatedAt: computedAt,
      },
      computedMetrics,
      riskResult.flags,
    );

    return {
      snapshotId: saveResult.id ?? null,
      computedMetrics,
      riskFlags: riskResult.flags,
    };
  } catch (e: any) {
    console.warn("[persistModelV2SnapshotFromDeal] failed (non-fatal):", e?.message);
    return null;
  }
}
