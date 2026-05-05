"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { useStageDataContext, type StageRefreshScope } from "../stageViews/_shared/StageDataProvider";
import {
  logInlineMutationStarted,
  logInlineMutationResult,
  logInlineMutationUndone,
  type InlineMutationKind,
} from "./logCockpitAction";

/**
 * SPEC-06 — runs an inline mutation with the same envelope as the shared
 * cockpit action runner: optimistic update → POST/PATCH → scoped refresh →
 * telemetry.
 *
 * SPEC-07 additions:
 *   - `reconcile(serverJson)` — caller can merge canonical entity from the
 *     server response back into the optimistic state, avoiding the immediate
 *     hard-refresh flicker. When provided AND the response carries a
 *     canonical entity, the post-mutation refresh is skipped (or deferred).
 *   - `undo` — caller registers a compensating mutation. SPEC-07 surfaces
 *     `lastUndo` for ~6s after success; calling `runUndo()` invokes the
 *     compensating mutation and emits a `cockpit_inline_mutation_undone`
 *     telemetry event.
 */

export type InlineMutationStatus = "idle" | "pending" | "success" | "error";

export type UndoableMutation = {
  /** Compensating mutation that reverses the previous one. */
  request: () => Promise<Response>;
  /** Optimistic update applied immediately on undo. */
  optimistic: () => void;
  /** Revert applied if the compensating request fails. */
  revert: () => void;
  /** Human label (e.g. "Mark satisfied"). Used for the undo button. */
  label: string;
};

export type InlineMutationState = {
  status: InlineMutationStatus;
  errorMessage: string | null;
  /** Identity of the row currently in flight. */
  activeId: string | null;
  /** SPEC-07: descriptor of the most recent undoable mutation, if any. */
  lastUndo:
    | {
        id: string;
        domain: string;
        scope: StageRefreshScope;
        label: string;
        expiresAt: number;
      }
    | null;
};

/** SPEC-07 — caller-supplied reconcile function. */
export type ReconcileFn<TServer> = (
  serverJson: TServer,
) => boolean;

export type RunInlineMutationOptions<TServer = unknown> = {
  /** Stable identifier of the affected row. */
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
  /**
   * SPEC-07: caller-supplied function that merges the canonical entity from
   * the server response into the optimistic state. Should return true when
   * a canonical entity was successfully merged, false otherwise. When true,
   * the runner skips the immediate hard refresh.
   */
  reconcile?: ReconcileFn<TServer>;
  /** SPEC-07: when present, surfaces an Undo affordance for ~6s. */
  undo?: UndoableMutation;
};

export type UseInlineMutationResult = {
  state: InlineMutationState;
  run: <TServer = unknown>(
    opts: RunInlineMutationOptions<TServer>,
  ) => Promise<boolean>;
  /** SPEC-07: invoke the most recent undoable mutation. */
  runUndo: () => Promise<boolean>;
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

const UNDO_VISIBLE_MS = 6_000;

export function useInlineMutation(dealId: string): UseInlineMutationResult {
  const { lifecycleState } = useCockpitDataContext();
  const lifecycleStage = lifecycleState?.stage ?? null;
  const { refreshStageData } = useStageDataContext();

  const [state, setState] = useState<InlineMutationState>({
    status: "idle",
    errorMessage: null,
    activeId: null,
    lastUndo: null,
  });

  const undoRef = useRef<UndoableMutation | null>(null);

  const clearError = useCallback(() => {
    setState((prev) =>
      prev.status === "error"
        ? { ...prev, status: "idle", errorMessage: null, activeId: null }
        : prev,
    );
  }, []);

  // Auto-expire the lastUndo descriptor when its window closes. setState
  // always lives inside the timeout — never synchronous in the effect body.
  useEffect(() => {
    if (!state.lastUndo) return;
    const ms = Math.max(0, state.lastUndo.expiresAt - Date.now());
    const t = setTimeout(() => {
      setState((prev) =>
        prev.lastUndo && prev.lastUndo.expiresAt <= Date.now() + 50
          ? { ...prev, lastUndo: null }
          : prev,
      );
      undoRef.current = null;
    }, ms);
    return () => clearTimeout(t);
  }, [state.lastUndo]);

  const run = useCallback(
    async <TServer = unknown>(
      opts: RunInlineMutationOptions<TServer>,
    ): Promise<boolean> => {
      setState((prev) => ({
        ...prev,
        status: "pending",
        errorMessage: null,
        activeId: opts.id,
      }));
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
      let serverJson: TServer | null = null;
      try {
        res = await opts.request();
        if (!res.ok) {
          errorMessage = await safeErrorBody(res);
        } else if (opts.reconcile) {
          // Read server JSON for reconciliation.
          try {
            serverJson = (await res.clone().json()) as TServer;
          } catch {
            serverJson = null;
          }
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
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: errorMessage ?? `HTTP ${res?.status ?? "unknown"}`,
          activeId: opts.id,
        }));
        logInlineMutationResult(telemetryCtx, false, errorMessage ?? undefined);
        return false;
      }

      // SPEC-07 reconcile path: merge canonical entity if available, skip the
      // immediate hard refresh.
      let reconciled = false;
      if (opts.reconcile && serverJson !== null) {
        try {
          reconciled = opts.reconcile(serverJson) === true;
        } catch {
          reconciled = false;
        }
      }

      // Hard refresh runs only when reconciliation didn't happen.
      const scope =
        opts.refreshScope ?? SCOPE_FOR_DOMAIN[opts.domain] ?? "all";
      if (!reconciled) {
        try {
          await refreshStageData(scope);
        } catch {
          // refresh failure is non-fatal — telemetry still records success
        }
      }

      const lastUndo = opts.undo
        ? {
            id: opts.id,
            domain: opts.domain,
            scope,
            label: opts.undo.label,
            expiresAt: Date.now() + UNDO_VISIBLE_MS,
          }
        : null;
      undoRef.current = opts.undo ?? null;

      setState({
        status: "success",
        errorMessage: null,
        activeId: opts.id,
        lastUndo,
      });
      logInlineMutationResult(telemetryCtx, true);
      return true;
    },
    [dealId, lifecycleStage, refreshStageData],
  );

  const runUndo = useCallback(async (): Promise<boolean> => {
    const last = state.lastUndo;
    const undo = undoRef.current;
    if (!last || !undo) return false;

    setState((prev) => ({
      ...prev,
      status: "pending",
      activeId: last.id,
      lastUndo: null,
    }));
    undoRef.current = null;

    const telemetryCtx = {
      dealId,
      lifecycleStage,
      domain: last.domain,
      // Treat undo as a 'status' kind — the underlying log payload tags
      // resultStatus="succeeded" via logInlineMutationUndone regardless.
      kind: "status" as InlineMutationKind,
      entityId: last.id,
    };

    try {
      undo.optimistic();
    } catch {
      // optimistic undo best-effort
    }

    let res: Response | null = null;
    let errorMessage: string | null = null;
    try {
      res = await undo.request();
      if (!res.ok) errorMessage = await safeErrorBody(res);
    } catch (err) {
      errorMessage = (err as Error).message ?? "undo_failed";
    }

    const ok = res !== null && res.ok;
    if (!ok) {
      try {
        undo.revert();
      } catch {
        // revert best-effort
      }
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: errorMessage ?? "undo_failed",
        activeId: last.id,
      }));
      logInlineMutationResult(telemetryCtx, false, errorMessage ?? undefined);
      return false;
    }

    try {
      await refreshStageData(last.scope);
    } catch {
      // non-fatal
    }

    setState({
      status: "success",
      errorMessage: null,
      activeId: last.id,
      lastUndo: null,
    });
    logInlineMutationUndone(telemetryCtx);
    return true;
  }, [dealId, lifecycleStage, refreshStageData, state.lastUndo]);

  return { state, run, runUndo, clearError };
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
