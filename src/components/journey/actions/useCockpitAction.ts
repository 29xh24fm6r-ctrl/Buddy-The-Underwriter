"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { useStageDataContext } from "../stageViews/_shared/StageDataProvider";
import { runCockpitAction } from "./runCockpitAction";
import {
  logCockpitActionStarted,
  logCockpitActionResult,
  logStageDataRefreshed,
} from "./logCockpitAction";
import type { CockpitAction, CockpitActionResult } from "./actionTypes";

export type CockpitActionStatus = "idle" | "pending" | "success" | "error";

export type CockpitActionState = {
  status: CockpitActionStatus;
  /** id of the action that's currently in flight or last-completed. */
  activeId: string | null;
  errorMessage: string | null;
};

export type RunOptions = {
  /** Stable identity used to disable the right button while pending. */
  id: string;
};

export type UseCockpitActionResult = {
  state: CockpitActionState;
  /** Execute an action through the unified executor + telemetry + refresh. */
  run: (action: CockpitAction, opts: RunOptions) => Promise<CockpitActionResult>;
  /** Manually clear an error after the user dismisses it. */
  clearError: () => void;
};

/**
 * SPEC-04 — single-action runner hook.
 *
 * Pipeline:
 *   1. log "started"
 *   2. navigate or POST via runCockpitAction
 *   3. on success: refreshStageData() + router.refresh() + log "succeeded"
 *   4. on failure: surface error + log "failed"
 *   5. always log "stage_data_refreshed" once after a successful refresh
 */
export function useCockpitAction(dealId: string): UseCockpitActionResult {
  const router = useRouter();
  const { refreshStageData } = useStageDataContext();
  const { lifecycleState } = useCockpitDataContext();
  const lifecycleStage = lifecycleState?.stage ?? null;

  const [state, setState] = useState<CockpitActionState>({
    status: "idle",
    activeId: null,
    errorMessage: null,
  });

  const clearError = useCallback(() => {
    setState((prev) =>
      prev.status === "error"
        ? { status: "idle", activeId: null, errorMessage: null }
        : prev,
    );
  }, []);

  const run = useCallback(
    async (action: CockpitAction, opts: RunOptions): Promise<CockpitActionResult> => {
      const ctx = { dealId, lifecycleStage };
      setState({ status: "pending", activeId: opts.id, errorMessage: null });
      logCockpitActionStarted(action, ctx);

      // Navigate intent: no fetch, just push and exit.
      if (action.intent === "navigate") {
        try {
          router.push(action.href);
          const result: CockpitActionResult = { ok: true, status: "ok" };
          logCockpitActionResult(action, ctx, result);
          setState({ status: "success", activeId: opts.id, errorMessage: null });
          return result;
        } catch (err) {
          const message = (err as Error).message ?? "navigation_failed";
          const result: CockpitActionResult = {
            ok: false,
            status: "error",
            errorMessage: message,
          };
          logCockpitActionResult(action, ctx, result);
          setState({ status: "error", activeId: opts.id, errorMessage: message });
          return result;
        }
      }

      // Runnable / fix_blocker: POST through the executor.
      const result = await runCockpitAction(action, dealId);
      logCockpitActionResult(action, ctx, result);

      if (!result.ok) {
        setState({
          status: "error",
          activeId: opts.id,
          errorMessage: result.errorMessage ?? "action_failed",
        });
        return result;
      }

      try {
        await refreshStageData();
        logStageDataRefreshed(ctx);
      } catch {
        // refresh failure is non-fatal — telemetry still records success
      }

      setState({ status: "success", activeId: opts.id, errorMessage: null });
      return result;
    },
    [dealId, lifecycleStage, router, refreshStageData],
  );

  return { state, run, clearError };
}
