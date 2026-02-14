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
import { extractBaseValues } from "@/lib/modelEngine/extractBaseValues";
import { resolveRegistryBinding } from "@/lib/metrics/registry/selectActiveVersion";
import { hashOutputs } from "@/lib/metrics/registry/hash";
import type { FinancialModel, RiskFlag } from "@/lib/modelEngine";

/**
 * Shared service: compute metrics + persist a V2 model snapshot.
 *
 * AUTHORITY RULE: Only computeAuthoritativeEngine (or v1_fallback path) may
 * call this function. V1 shadow comparison must NEVER persist snapshots.
 *
 * Returns the snapshotId and computed metrics, or null on failure.
 * Never throws — callers use fire-and-forget.
 */
export async function persistModelV2SnapshotFromDeal(opts: {
  dealId: string;
  bankId: string;
  model: FinancialModel;
  engineSource: "authoritative" | "v1_fallback";
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
    const baseValues = extractBaseValues(model);

    // 3. Evaluate metrics
    const computedMetrics = evaluateMetricGraph(metricDefs, baseValues);

    // 4. Risk engine
    const riskResult = evaluateRisk(computedMetrics);

    // 5. Hashes
    const metricRegistryHash = deterministicHash(metricDefs);
    const financialModelHash = deterministicHash(model);
    const computedAt = new Date().toISOString();
    const traceId = crypto.randomUUID();

    // 5b. Phase 12/13: resolve registry binding (bank-aware, non-fatal)
    const binding = await resolveRegistryBinding(sb, bankId).catch(() => null);

    // 5c. Phase 12: compute outputs hash
    const outputsPayload = { computedMetrics, riskFlags: riskResult.flags };
    const computedOutputsHash = hashOutputs(outputsPayload);

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
        // Phase 12: registry binding
        registryVersionId: binding?.registryVersionId ?? null,
        registryVersionName: binding?.registryVersionName ?? null,
        registryContentHash: binding?.registryContentHash ?? null,
        engineVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
        computeTraceId: traceId,
        outputsHash: computedOutputsHash,
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
