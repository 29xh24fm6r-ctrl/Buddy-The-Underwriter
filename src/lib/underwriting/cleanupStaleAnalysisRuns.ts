/**
 * Stale analysis-run reaper.
 *
 * Banker analysis claims a `risk_runs` row with `status='running'` for the
 * duration of a run. If a run dies mid-flight (Vercel timeout, redeploy,
 * unhandled crash) the row is left in `running` and the next caller would be
 * blocked by `ALREADY_RUNNING` until the 60-second freshness window passes —
 * but the dedup window is for back-to-back triggers, not minutes-old orphans.
 *
 * This module sweeps `running` rows older than the configured cutoff
 * (default 10 minutes), marks them `failed` with `error='stale_running_timeout'`,
 * and emits a deal_event so the UI can surface a `STALE_RUN_RECOVERED` warning.
 *
 * Called inline from `runBankerAnalysisPipeline` at the start of every run.
 */

import { assertServerOnly } from "@/lib/serverOnly";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { writeEvent as WriteEventFn } from "@/lib/ledger/writeEvent";

assertServerOnly();

export const STALE_RUN_CUTOFF_MS = 10 * 60 * 1000;
export const STALE_RUN_ERROR = "stale_running_timeout";
export const STALE_RUN_EVENT_KIND = "banker_analysis.stale_run_recovered";
export const PIPELINE_MODEL_NAME = "banker_analysis_pipeline";

export type CleanupStaleAnalysisRunsInput = {
  /** Optional — when provided, only that deal's stale rows are reaped. */
  dealId?: string;
  /** Override the cutoff (ms). Production callers leave undefined. */
  cutoffMs?: number;
  /** Test seam — production callers leave undefined. */
  _deps?: {
    sb?: SupabaseClient;
    writeEvent?: typeof WriteEventFn;
  };
};

export type CleanupStaleAnalysisRunsResult = {
  reaped: Array<{
    riskRunId: string;
    dealId: string;
    createdAt: string | null;
  }>;
};

export async function cleanupStaleAnalysisRuns(
  input: CleanupStaleAnalysisRunsInput = {},
): Promise<CleanupStaleAnalysisRunsResult> {
  const cutoffMs = input.cutoffMs ?? STALE_RUN_CUTOFF_MS;
  const cutoff = new Date(Date.now() - cutoffMs).toISOString();
  const deps = input._deps ?? {};

  const sb = deps.sb ?? (await loadAdmin());
  const emit = deps.writeEvent ?? (await loadWriteEvent());

  let q = sb
    .from("risk_runs")
    .select("id, deal_id, created_at")
    .eq("status", "running")
    .eq("model_name", PIPELINE_MODEL_NAME)
    .lt("created_at", cutoff);
  if (input.dealId) {
    q = q.eq("deal_id", input.dealId);
  }

  const { data, error } = await q;
  if (error) {
    console.warn("[cleanupStaleAnalysisRuns] select failed (non-fatal):", error.message);
    return { reaped: [] };
  }

  const stale = (data ?? []) as Array<{
    id: string;
    deal_id: string;
    created_at: string | null;
  }>;
  if (stale.length === 0) return { reaped: [] };

  const ids = stale.map((r) => r.id);
  const { error: updateErr } = await sb
    .from("risk_runs")
    .update({ status: "failed", error: STALE_RUN_ERROR })
    .in("id", ids);
  if (updateErr) {
    console.warn(
      "[cleanupStaleAnalysisRuns] update failed (non-fatal):",
      updateErr.message,
    );
    return { reaped: [] };
  }

  // Emit one event per recovered run so the UI can surface STALE_RUN_RECOVERED.
  for (const row of stale) {
    try {
      await emit({
        dealId: row.deal_id,
        kind: STALE_RUN_EVENT_KIND,
        scope: "underwriting",
        action: "stale_run_recovered",
        meta: {
          risk_run_id: row.id,
          created_at: row.created_at,
          cutoff,
          error: STALE_RUN_ERROR,
        },
      });
    } catch (e) {
      console.warn(
        "[cleanupStaleAnalysisRuns] writeEvent failed (non-fatal):",
        e instanceof Error ? e.message : "unknown",
      );
    }
  }

  return {
    reaped: stale.map((r) => ({
      riskRunId: r.id,
      dealId: r.deal_id,
      createdAt: r.created_at,
    })),
  };
}

async function loadAdmin(): Promise<SupabaseClient> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin();
}

async function loadWriteEvent(): Promise<typeof WriteEventFn> {
  const m = await import("@/lib/ledger/writeEvent");
  return m.writeEvent;
}
