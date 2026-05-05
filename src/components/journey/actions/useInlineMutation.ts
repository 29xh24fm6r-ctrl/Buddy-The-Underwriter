"use client";

import { useCallback, useState } from "react";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { useStageDataContext, type StageRefreshScope } from "../stageViews/_shared/StageDataProvider";
import {
  logInlineMutationStarted,
  logInlineMutationResult,
  type InlineMutationKind,
} from "./logCockpitAction";

/**
 * SPEC-06 — runs an inline mutation with the same envelope as the shared
 * cockpit action runner: optimistic update → POST/PATCH → scoped refresh →
 * telemetry. On failure, the optimistic state is reverted via the caller-
 * supplied `revert` callback so the user sees the row return to its
 * previous value.
 */

export type InlineMutationStatus = "idle" | "pending" | "success" | "error";

export type InlineMutationState = {
  status: InlineMutationStatus;
  errorMessage: string | null;
  /** Identity of the row currently in flight. */
  activeId: string | null;
};

export type RunInlineMutationOptions = {
  /** Stable identifier of the affected row (for pending/error scoping). */
  id: string;
  /** Telemetry kind: add / update / status / review / delete. */
  kind: InlineMutationKind;
  /** Domain (e.g. "conditions", "overrides"). */
  domain: string;
  /** Refresh scope to call after success. Defaults to domain. */
  refreshScope?: StageRefreshScope;
  /** Optimistic mutation applied immediately. */
  optimistic: () => void;
  /** Reverts the optimistic mutation if the request fails. */
  revert: () => void;
  /** Performs the actual fetch. Resolve = success, reject/throw = failure. */
  request: () => Promise<Response>;
};

export type UseInlineMutationResult = {
  state: InlineMutationState;
  run: (opts: RunInlineMutationOptions) => Promise<boolean>;
  clearError: () => void;
};

const SCOPE_FOR_DOMAIN: Record<string, StageRefreshScope> = {
  conditions: "conditions",
  overrides: "overrides",
  documents: "documents",
  underwriting: "underwriting",
  memo: "memo",
  decision: "decision",
  closing: "closing",
};

export function useInlineMutation(dealId: string): UseInlineMutationResult {
  const { lifecycleState } = useCockpitDataContext();
  const lifecycleStage = lifecycleState?.stage ?? null;
  const { refreshStageData } = useStageDataContext();

  const [state, setState] = useState<InlineMutationState>({
    status: "idle",
    errorMessage: null,
    activeId: null,
  });

  const clearError = useCallback(() => {
    setState((prev) =>
      prev.status === "error"
        ? { status: "idle", errorMessage: null, activeId: null }
        : prev,
    );
  }, []);

  const run = useCallback(
    async (opts: RunInlineMutationOptions): Promise<boolean> => {
      setState({ status: "pending", errorMessage: null, activeId: opts.id });
      const telemetryCtx = {
        dealId,
        lifecycleStage,
        domain: opts.domain,
        kind: opts.kind,
        entityId: opts.id,
      };
      logInlineMutationStarted(telemetryCtx);

      // Apply optimistic update immediately.
      try {
        opts.optimistic();
      } catch {
        // optimistic update is best-effort; failure is non-fatal
      }

      let res: Response | null = null;
      let errorMessage: string | null = null;
      try {
        res = await opts.request();
        if (!res.ok) {
          errorMessage = await safeErrorBody(res);
        }
      } catch (err) {
        errorMessage = (err as Error).message ?? "request_failed";
      }

      const ok = res !== null && res.ok;

      if (!ok) {
        try {
          opts.revert();
        } catch {
          // revert is best-effort
        }
        setState({
          status: "error",
          errorMessage: errorMessage ?? `HTTP ${res?.status ?? "unknown"}`,
          activeId: opts.id,
        });
        logInlineMutationResult(telemetryCtx, false, errorMessage ?? undefined);
        return false;
      }

      // Reconcile with canonical state via scoped refresh.
      const scope =
        opts.refreshScope ?? SCOPE_FOR_DOMAIN[opts.domain] ?? "all";
      try {
        await refreshStageData(scope);
      } catch {
        // refresh failure is non-fatal — telemetry still records success
      }

      setState({ status: "success", errorMessage: null, activeId: opts.id });
      logInlineMutationResult(telemetryCtx, true);
      return true;
    },
    [dealId, lifecycleStage, refreshStageData],
  );

  return { state, run, clearError };
}

async function safeErrorBody(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === "object") {
        const errStr = (json as { error?: unknown }).error;
        if (typeof errStr === "string") return errStr;
        if (errStr && typeof errStr === "object") {
          const m = (errStr as { message?: unknown }).message;
          if (typeof m === "string") return m;
        }
      }
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return null;
  }
}
