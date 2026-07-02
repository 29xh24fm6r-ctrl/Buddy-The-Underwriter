"use client";
// SPEC-GUIDED-STAGE-RAIL-1 — when the current stage's blockers reach zero, advance once.
// Server remains the guard: /lifecycle/advance re-derives and refuses if actually blocked.
import { useEffect, useRef } from "react";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import { stageClearForAdvance } from "@/lib/journey/stageSteps";
// The existing LIFECYCLE_INVALIDATE_EVENT dispatcher (do not create a second event name).
import { invalidateJourneyState } from "@/hooks/useJourneyState";

export function useAutoAdvance(dealId: string, state: LifecycleState | null) {
  // one attempt per (dealId, stage) per mount — never loops, never retries a refusal
  const attempted = useRef<string>("");

  useEffect(() => {
    if (!state) return;
    const key = `${dealId}:${state.stage}`;
    if (attempted.current === key) return;
    if (!stageClearForAdvance(state)) return;

    attempted.current = key;
    void fetch(`/api/deals/${dealId}/lifecycle/advance`, { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res?.ok && res?.advanced) invalidateJourneyState(dealId);
      })
      .catch(() => { /* silent — poll/focus refetch recovers */ });
  }, [dealId, state]);
}
