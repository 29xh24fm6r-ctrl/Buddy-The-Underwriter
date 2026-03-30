import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Verify the current Model Engine V2 operating state.
 * Pure diagnostic — reads only, never mutates.
 *
 * Answers:
 * 1. Is V2 enabled?
 * 2. Is registry loading?
 * 3. Are snapshots being written?
 * 4. What env flags are set?
 */
export async function verifyV2OperatingState(): Promise<{
  v2Enabled: boolean;
  envFlags: Record<string, string | undefined>;
  registryHealth: {
    metricCount: number;
    loaded: boolean;
    error: string | null;
  };
  snapshotHealth: {
    totalSnapshots: number;
    recentSnapshotCount: number;
    latestSnapshotAt: string | null;
  };
  diagnostics: string[];
}> {
  const diagnostics: string[] = [];
  const sb = supabaseAdmin();

  // Env flags
  const envFlags = {
    MODEL_ENGINE_PRIMARY: process.env.MODEL_ENGINE_PRIMARY,
    MODEL_ENGINE_MODE: process.env.MODEL_ENGINE_MODE,
    SHADOW_COMPARE: process.env.SHADOW_COMPARE,
    V2_FALLBACK_TO_V1: process.env.V2_FALLBACK_TO_V1,
    V1_RENDERER_DISABLED: process.env.V1_RENDERER_DISABLED,
  };

  const v2Enabled =
    envFlags.MODEL_ENGINE_PRIMARY === "V2" ||
    envFlags.MODEL_ENGINE_MODE === "v2_primary";

  if (v2Enabled) {
    diagnostics.push("V2 is primary engine");
  } else {
    diagnostics.push("V2 is NOT primary — V1 remains default");
  }

  if (envFlags.SHADOW_COMPARE === "true") {
    diagnostics.push("Shadow comparison is enabled");
  }

  // Registry health
  let registryHealth = { metricCount: 0, loaded: false, error: null as string | null };
  try {
    const { data: metrics, error } = await sb
      .from("metric_definitions")
      .select("id")
      .limit(100);

    if (error) {
      registryHealth.error = error.message;
      diagnostics.push(`Registry error: ${error.message}`);
    } else {
      registryHealth.metricCount = metrics?.length ?? 0;
      registryHealth.loaded = (metrics?.length ?? 0) > 0;
      diagnostics.push(`Registry: ${metrics?.length ?? 0} metric definitions loaded`);
    }
  } catch (err) {
    registryHealth.error = err instanceof Error ? err.message : "Unknown";
    diagnostics.push(`Registry load failed: ${registryHealth.error}`);
  }

  // Snapshot health
  let snapshotHealth = {
    totalSnapshots: 0,
    recentSnapshotCount: 0,
    latestSnapshotAt: null as string | null,
  };
  try {
    const { count } = await sb
      .from("deal_model_snapshots")
      .select("id", { count: "exact", head: true });

    snapshotHealth.totalSnapshots = count ?? 0;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await sb
      .from("deal_model_snapshots")
      .select("id", { count: "exact", head: true })
      .gt("created_at", oneDayAgo);

    snapshotHealth.recentSnapshotCount = recentCount ?? 0;

    const { data: latest } = await sb
      .from("deal_model_snapshots")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    snapshotHealth.latestSnapshotAt = latest?.created_at ?? null;

    diagnostics.push(`Snapshots: ${count ?? 0} total, ${recentCount ?? 0} in last 24h`);
    if (latest?.created_at) {
      diagnostics.push(`Latest snapshot: ${latest.created_at}`);
    }
  } catch (err) {
    diagnostics.push(`Snapshot check failed: ${err instanceof Error ? err.message : "Unknown"}`);
  }

  return {
    v2Enabled,
    envFlags,
    registryHealth,
    snapshotHealth,
    diagnostics,
  };
}
