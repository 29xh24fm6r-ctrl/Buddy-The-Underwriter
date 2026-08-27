import { useEffect, useRef, useState } from "react";

export type PipelineUiState = "working" | "done" | "waiting";

export interface LatestEvent {
  event_key: string;
  ui_state: PipelineUiState;
  ui_message: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface PipelineLatestResponse {
  ok: true;
  latestEvent: LatestEvent | null;
  state: any | null; // kept for backwards compatibility
  computedPipeline?: {
    ui_state: PipelineUiState;
    ui_message: string;
  };
}

export interface PipelineState {
  uiState: PipelineUiState;
  isWorking: boolean;
  lastMessage: string | null;
  lastUpdatedAt: string | null;
  eventKey: string | null;
  meta: Record<string, unknown> | null;
  source?: "ledger" | "demo"; // demo override indicator
}

/**
 * Check if demo mode is active via URL params
 * ?__mode=demo&__state=working&__message=Analyzing tax returns...
 */
function getDemoOverride(): PipelineState | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("__mode");

  if (mode !== "demo") return null;

  const state = params.get("__state") as PipelineUiState | null;
  const message = params.get("__message");

  if (!state || !["working", "done", "waiting"].includes(state)) {
    return null;
  }

  return {
    uiState: state,
    isWorking: state === "working",
    lastMessage: message || `Demo mode: ${state}`,
    lastUpdatedAt: new Date().toISOString(),
    eventKey: "demo_override",
    meta: { demo: true },
    source: "demo",
  };
}

async function fetchLatest(
  dealId: string,
  signal: AbortSignal,
): Promise<PipelineLatestResponse> {
  const res = await fetch(`/api/deals/${dealId}/pipeline/latest`, {
    cache: "no-store",
    signal,
  });
  // Even if res is non-200, treat as transient and return empty
  if (!res.ok) {
    return { ok: true, latestEvent: null, state: null };
  }
  return res.json();
}

export function usePipelineState(dealId: string | null) {
  // Check for demo mode override first
  const demoOverride = getDemoOverride();

  const [pipeline, setPipeline] = useState<PipelineState>(
    demoOverride || {
      uiState: "done",
      isWorking: false,
      lastMessage: null,
      lastUpdatedAt: null,
      eventKey: null,
      meta: null,
      source: "ledger",
    }
  );

  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const inflightRef = useRef(false);

  useEffect(() => {
    // If demo mode active, skip polling and use override
    if (demoOverride) {
      setPipeline(demoOverride);
      return;
    }

    if (!dealId) return;

    let cancelled = false;

    const clearScheduledPoll = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const schedule = (ms: number) => {
      clearScheduledPoll();
      if (cancelled || document.visibilityState !== "visible") return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (inflightRef.current) {
        schedule(100);
        return;
      }

      inflightRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const json = await fetchLatest(dealId, controller.signal);
        if (cancelled || document.visibilityState !== "visible") return;

        const ev = json.latestEvent;
        const computed = json.computedPipeline;

        const uiState: PipelineUiState =
          (ev?.ui_state as PipelineUiState) ??
          (computed?.ui_state as PipelineUiState) ??
          "done";

        const isWorking = uiState === "working";

        setPipeline({
          uiState,
          isWorking,
          lastMessage: ev?.ui_message ?? computed?.ui_message ?? null,
          lastUpdatedAt: ev?.created_at ?? null,
          eventKey: ev?.event_key ?? (computed ? "computed_busy" : null),
          meta: (ev?.meta as Record<string, unknown>) ?? null,
          source: "ledger",
        });

        setError(null);

        // Adaptive polling: fast while working, slow while idle.
        schedule(isWorking ? 2000 : 15000);
      } catch (e: any) {
        if (
          cancelled ||
          document.visibilityState !== "visible" ||
          e?.name === "AbortError"
        ) {
          return;
        }
        setError(e?.message ?? "pipeline polling failed");
        schedule(15000);
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        inflightRef.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        clearScheduledPoll();
        controllerRef.current?.abort();
        return;
      }
      void tick();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void tick();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearScheduledPoll();
      controllerRef.current?.abort();
      controllerRef.current = null;
      inflightRef.current = false;
    };
  }, [dealId]);

  return { pipeline, pipelineError: error };
}
