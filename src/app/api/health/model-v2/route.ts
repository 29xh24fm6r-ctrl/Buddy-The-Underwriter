import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  selectModelEngineMode,
  isV1RendererDisabled,
  isShadowCompareEnabled,
} from "@/lib/modelEngine/modeSelector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/model-v2
 *
 * Unauthenticated health endpoint — production truth source for engine status.
 * Reports V2 as the authoritative computation engine.
 * Returns JSON always, never HTML.
 *
 * Optional: ?writeCheckDealId=<uuid> triggers a snapshot write test (non-fatal).
 */
export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const modeResult = selectModelEngineMode({ isOpsOverride: true });

    // Determine primary engine
    const primaryEngine = modeResult.mode === "v1" ? "v1" : "v2";

    // Metric definitions count
    const { count: metricCount, error: metricErr } = await sb
      .from("metric_definitions")
      .select("*", { count: "exact", head: true })
      .eq("version", "v1");

    // Snapshots count
    const { count: snapshotCount, error: snapshotErr } = await sb
      .from("deal_model_snapshots")
      .select("*", { count: "exact", head: true });

    // Registry load check
    let registryOk = false;
    let registrySource: "db" | "seed" | "error" = "error";
    try {
      const { loadMetricRegistry } = await import("@/lib/modelEngine");
      const defs = await loadMetricRegistry(sb, "v1");
      registryOk = defs.length > 0;
      registrySource = metricCount && metricCount > 0 && defs.length === metricCount ? "db" : "seed";
    } catch {
      registryOk = false;
    }

    // Diff events count (legacy comparison)
    const { count: diffEventCount } = await (sb as any)
      .from("buddy_system_events")
      .select("*", { count: "exact", head: true })
      .eq("error_code", "STANDARD_RENDER_DIFF");

    // V1 render attempts blocked (Phase 11)
    const { count: v1BlockedCount } = await (sb as any)
      .from("buddy_system_events")
      .select("*", { count: "exact", head: true })
      .eq("error_code", "MODEL_V1_RENDER_ATTEMPT_BLOCKED");

    // V2 primary served count
    const { count: primaryServedCount } = await (sb as any)
      .from("buddy_system_events")
      .select("*", { count: "exact", head: true })
      .eq("error_code", "MODEL_V2_PRIMARY_SERVED");

    // V2 fallback count
    const { count: fallbackCount } = await (sb as any)
      .from("buddy_system_events")
      .select("*", { count: "exact", head: true })
      .eq("error_code", "MODEL_V2_FALLBACK_TO_V1");

    // Phase 12: Registry versioning health
    let registryVersioning: {
      activeVersionName: string | null;
      activeContentHash: string | null;
      publishedVersionsCount: number;
      lastPublishedAt: string | null;
      replayMismatchCount24h: number;
    } | undefined;
    try {
      const { selectActiveVersion } = await import("@/lib/metrics/registry/selectActiveVersion");
      const active = await selectActiveVersion(sb);

      const { count: publishedCount } = await sb
        .from("metric_registry_versions")
        .select("*", { count: "exact", head: true })
        .eq("status", "published");

      const { data: latestPublished } = await sb
        .from("metric_registry_versions")
        .select("published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
      const { count: mismatchCount } = await (sb as any)
        .from("buddy_system_events")
        .select("*", { count: "exact", head: true })
        .eq("error_code", "METRIC_REGISTRY_REPLAY_MISMATCH")
        .gte("created_at", oneDayAgo);

      registryVersioning = {
        activeVersionName: active?.versionName ?? null,
        activeContentHash: active?.contentHash ?? null,
        publishedVersionsCount: publishedCount ?? 0,
        lastPublishedAt: latestPublished?.published_at ?? null,
        replayMismatchCount24h: mismatchCount ?? 0,
      };
    } catch {
      // Non-fatal — tables may not exist yet
    }

    // Phase 13: Drift detection (latest snapshot per deal only)
    let driftDetection: {
      activeVersion: string | null;
      dealsWithDrift: number;
      driftEventCount24h: number;
    } | undefined;
    try {
      const activeVersionName = registryVersioning?.activeVersionName ?? null;
      if (activeVersionName) {
        // Count deals whose latest snapshot has a different registry version
        // Uses DISTINCT ON (deal_id) ORDER BY calculated_at DESC
        const { data: driftData } = await (sb as any).rpc("count_deals_with_registry_drift", {
          p_active_version_name: activeVersionName,
        });
        const dealsWithDrift = typeof driftData === "number" ? driftData : (driftData?.[0]?.count ?? 0);

        const oneDayAgo2 = new Date(Date.now() - 86400000).toISOString();
        const { count: driftEventCount } = await (sb as any)
          .from("buddy_system_events")
          .select("*", { count: "exact", head: true })
          .eq("error_code", "METRIC_REGISTRY_DRIFT_DETECTED")
          .gte("created_at", oneDayAgo2);

        driftDetection = {
          activeVersion: activeVersionName,
          dealsWithDrift: typeof dealsWithDrift === "number" ? dealsWithDrift : 0,
          driftEventCount24h: driftEventCount ?? 0,
        };
      }
    } catch {
      // Non-fatal — RPC may not exist yet
    }

    // Optional write-check: attempt to persist a snapshot for a specific deal
    const url = new URL(req.url);
    const writeCheckDealId = url.searchParams.get("writeCheckDealId");
    let snapshotWrite: { ok: boolean; snapshotId?: string; error?: string } | undefined;

    if (writeCheckDealId) {
      try {
        const { buildFinancialModel } = await import("@/lib/modelEngine");
        const { persistModelV2SnapshotFromDeal } = await import(
          "@/lib/modelEngine/services/persistModelV2SnapshotFromDeal"
        );

        // Load facts for the deal
        const { data: facts } = await (sb as any)
          .from("deal_financial_facts")
          .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
          .eq("deal_id", writeCheckDealId)
          .neq("fact_type", "EXTRACTION_HEARTBEAT");

        const model = buildFinancialModel(writeCheckDealId, facts ?? []);
        // Look up bank_id from the deal
        const { data: deal } = await sb
          .from("deals")
          .select("bank_id")
          .eq("id", writeCheckDealId)
          .maybeSingle();

        const result = await persistModelV2SnapshotFromDeal({
          dealId: writeCheckDealId,
          bankId: deal?.bank_id ?? "",
          model,
          engineSource: "authoritative",
        });

        snapshotWrite = result
          ? { ok: true, snapshotId: result.snapshotId ?? undefined }
          : { ok: false, error: "persist returned null" };
      } catch (e: any) {
        snapshotWrite = { ok: false, error: e?.message ?? "write_check_failed" };
      }
    }

    return NextResponse.json({
      ok: true,
      status: "healthy",
      primary_engine: primaryEngine,
      shadow_compare_enabled: isShadowCompareEnabled(),
      v2_enabled: true,
      v2_mode: modeResult.mode,
      v2_mode_reason: modeResult.reason,
      metric_definitions: {
        count: metricCount ?? 0,
        error: metricErr?.message ?? null,
      },
      deal_model_snapshots: {
        count: snapshotCount ?? 0,
        error: snapshotErr?.message ?? null,
      },
      v1_renderer_disabled: isV1RendererDisabled(),
      diff_events: {
        count: diffEventCount ?? 0,
      },
      v1_render_blocked: {
        count: v1BlockedCount ?? 0,
      },
      primary_served: {
        count: primaryServedCount ?? 0,
      },
      fallback_count: fallbackCount ?? 0,
      registry: {
        loaded: registryOk,
        source: registrySource,
      },
      policy_version: await (async () => {
        try {
          const { POLICY_DEFINITIONS_VERSION } = await import("@/lib/policyEngine/version");
          return POLICY_DEFINITIONS_VERSION;
        } catch { return null; }
      })(),
      audit_mode_ready: true,
      ...(snapshotWrite ? { snapshot_write: snapshotWrite } : {}),
      ...(registryVersioning ? { registry_versioning: registryVersioning } : {}),
      ...(driftDetection ? { drift_detection: driftDetection } : {}),
      checked_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status: "error",
      error: e?.message ?? "unexpected_error",
      checked_at: new Date().toISOString(),
    }, { status: 500 });
  }
}
