"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { BuddySignal } from "@/buddy/types";
import { getBuddySignalEventName } from "@/buddy/emitBuddySignal";
import { useBuddyServerSignals } from "@/buddy/useBuddyServerSignals";
import { useBuddyFlightRecorder } from "@/buddy/core/useBuddyFlightRecorder";
import { buildContextPack } from "@/buddy/brain/buildContextPack";
import { decideReply } from "@/buddy/brain/policyEngine";
import { decideNextBestAction } from "@/buddy/nba/decideNextBestAction";
import { calcReadiness } from "@/buddy/readiness/calcReadiness";
import { calcOutcome } from "@/buddy/outcomes/calcOutcome";
import { BuddyPanel } from "@/buddy/ui/BuddyPanel";
import {
  addFinding,
  appendInsight,
  appendSignal,
  loadBuddySession,
  saveBuddySession,
  startRun,
  stopRun,
  type BuddySessionState,
} from "@/buddy/memory/buddySessionStore";
import type { FindingKind, FindingSeverity } from "@/buddy/findings";
import type { OutcomeSnapshot } from "@/buddy/outcomes/types";

type BuddyCtx = {
  state: BuddySessionState;
  setOpen: (open: boolean) => void;
  emit: (sig: BuddySignal) => void;
  note: (message: string, severity?: "info" | "warn" | "risk") => void;
  startRun: () => void;
  stopRun: () => void;
  addFinding: (input: {
    kind: FindingKind;
    severity?: FindingSeverity;
    note?: string;
    path?: string;
    sourceSignalTs: number;
  }) => void;
  updateFinding: (id: string, patch: Partial<{ severity: FindingSeverity; note: string }>) => void;
  setLastNudgeAtIso: (iso: string | null) => void;
  setExplainMarkdown: (dealId: string, md: string) => void;
  pushToast: (text: string) => void;
  setOutcomeSnapshot: (snapshot: OutcomeSnapshot | null) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setPanelWidth: (width: number) => void;
};

const Ctx = createContext<BuddyCtx | null>(null);

function envObserverEnabled() {
  return process.env.NEXT_PUBLIC_BUDDY_OBSERVER_MODE === "1";
}

function classifySignal(sig: BuddySignal): {
  severity: "info" | "warn" | "risk";
  title: string;
  detail?: string;
  suggestedNext?: string;
} | null {
  const sev = sig.severity || "info";

  if ((sig.hesitationScore ?? 0) >= 0.7) {
    return {
      severity: "warn",
      title: "Hesitation detected",
      detail: "User hesitation is high. Reassure competence and frame the next step as a shared roadmap.",
      suggestedNext: "Offer a gameplan: what we know, what we need next, and why it helps them win.",
    };
  }

  if (sig.action === "confused") {
    return {
      severity: "risk",
      title: "Confusion reported",
      detail: sig.message || "User reported confusion.",
      suggestedNext: "Rewrite this step in borrower-safe language; reduce required fields; add contextual examples.",
    };
  }

  if (sig.action === "dead_end") {
    return {
      severity: "risk",
      title: "Dead end / stuck moment",
      detail: sig.message || "User feels blocked.",
      suggestedNext: "Add a visible path forward: suggested next action + fail-open fallback + human escalation option.",
    };
  }

  if (sig.message) {
    return {
      severity: sev,
      title: sig.action ? `Signal: ${sig.action}` : "Signal",
      detail: sig.message,
    };
  }

  return null;
}

export function BuddyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<BuddySessionState>(() => loadBuddySession());
  const pathname = usePathname();

  useEffect(() => {
    saveBuddySession(state);
  }, [state]);

  useEffect(() => {
    const role =
      (process.env.NEXT_PUBLIC_BUDDY_ROLE as any) || (envObserverEnabled() ? "builder" : state.role);
    if (role !== state.role) setState((s) => ({ ...s, role }));
  }, [state.role]);

  const setOpen = useCallback((open: boolean) => {
    setState((s) => ({ ...s, isOpen: open }));
  }, []);

  const setPanelCollapsed = useCallback((collapsed: boolean) => {
    setState((s) => ({ ...s, panelCollapsed: collapsed }));
  }, []);

  const setPanelWidth = useCallback((width: number) => {
    const clamped = Math.max(280, Math.min(440, Math.round(width)));
    setState((s) => ({ ...s, panelWidth: clamped }));
  }, []);

  const emit = useCallback((sig: BuddySignal) => {
    setState((s) => {
      let next = appendSignal(s, sig);

      if (sig.route) next = { ...next, lastRoute: sig.route };
      if (sig.page) next = { ...next, lastPage: sig.page };
      if (typeof sig.dealId !== "undefined") next = { ...next, dealId: sig.dealId };

      if (envObserverEnabled()) {
        const insight = classifySignal(sig);
        if (insight) {
          next = appendInsight(next, {
            ...insight,
            route: sig.route ?? next.lastRoute,
            page: sig.page ?? next.lastPage,
            dealId: next.dealId ?? null,
            meta: sig.meta,
          });
        }
      }

      const interpreted = interpretSignal(sig);
      if (interpreted) {
        next = { ...next, narration: interpreted };
      }

      try {
        const ctx = buildContextPack({ state: next, path: pathname ?? "" });
        const reply = decideReply(ctx);
        if (reply?.message) {
          next = { ...next, narration: { message: reply.message, tone: reply.intent } };
        }

        const nba = decideNextBestAction(ctx, next.lastNudgeAtIso ?? null);
        if (nba) {
          next = { ...next, nextBestAction: nba };
        }

        const readiness = calcReadiness(ctx);
        next = { ...next, readiness };

        const outcome = calcOutcome(next.lastOutcomeSnapshot ?? null, readiness);
        if (outcome?.message) {
          const text = `Nice — ${outcome.message}.`;
          const ts = Date.now();
          next = appendSignal(next, {
            type: "ui.toast",
            source: "buddy/core/BuddyProvider",
            payload: { text },
            ts,
          });
          next = {
            ...next,
            toasts: [...(next.toasts ?? []), { id: `t_${ts}`, ts, text }].slice(-3),
            narration: { message: text, tone: "info" },
            lastOutcomeSnapshot: null,
          };
        }
      } catch {
        // ignore
      }

      return next;
    });
  }, [pathname]);

  const note = useCallback(
    (message: string, severity: "info" | "warn" | "risk" = "info") => {
      emit({
        type: "user.action",
        source: "buddy/core/BuddyProvider",
        payload: { action: "note" },
        action: "note",
        message,
        severity,
      });
    },
    [emit]
  );

  const startExplorationRun = useCallback(() => {
    setState((s) => startRun(s));
    emit({
      type: "user.action",
      source: "buddy/core/BuddyProvider",
      payload: { action: "start_exploration_run" },
    });
  }, [emit]);

  const stopExplorationRun = useCallback(() => {
    setState((s) => stopRun(s));
    emit({
      type: "user.action",
      source: "buddy/core/BuddyProvider",
      payload: { action: "stop_exploration_run" },
    });
  }, [emit]);

  const addFindingToState = useCallback(
    (input: {
      kind: FindingKind;
      severity?: FindingSeverity;
      note?: string;
      path?: string;
      sourceSignalTs: number;
    }) => {
      setState((s) => {
        let next = s;
        if (!next.runId) {
          next = startRun(next);
        }
        return addFinding(next, input);
      });
    },
    []
  );

  const updateFinding = useCallback((id: string, patch: Partial<{ severity: FindingSeverity; note: string }>) => {
    setState((s) => ({
      ...s,
      findings: (s.findings ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  }, []);

  const setLastNudgeAtIso = useCallback((iso: string | null) => {
    setState((s) => ({ ...s, lastNudgeAtIso: iso }));
  }, []);

  const setExplainMarkdown = useCallback((dealId: string, md: string) => {
    setState((s) => ({
      ...s,
      explainMarkdownByDeal: { ...(s.explainMarkdownByDeal ?? {}), [dealId]: md },
    }));
  }, []);

  const setOutcomeSnapshot = useCallback((snapshot: OutcomeSnapshot | null) => {
    setState((s) => ({
      ...s,
      lastOutcomeSnapshot: snapshot,
    }));
  }, []);

  const pushToast = useCallback(
    (text: string) => {
      setState((s) => ({
        ...s,
        toasts: [...(s.toasts ?? []), { id: `t_${Date.now()}`, ts: Date.now(), text }].slice(-3),
      }));
      emit({
        type: "ui.toast",
        source: "buddy/core/BuddyProvider",
        payload: { text },
      });
    },
    [emit]
  );

  const value = useMemo(
    () => ({
      state,
      setOpen,
      emit,
      note,
      startRun: startExplorationRun,
      stopRun: stopExplorationRun,
      addFinding: addFindingToState,
      updateFinding,
      setLastNudgeAtIso,
      setExplainMarkdown,
      pushToast,
      setOutcomeSnapshot,
      setPanelCollapsed,
      setPanelWidth,
    }),
    [
      state,
      setOpen,
      emit,
      note,
      startExplorationRun,
      stopExplorationRun,
      addFindingToState,
      updateFinding,
      setLastNudgeAtIso,
      setExplainMarkdown,
      pushToast,
      setOutcomeSnapshot,
      setPanelCollapsed,
      setPanelWidth,
    ]
  );

  const eventName = useMemo(() => getBuddySignalEventName(), []);

  useBuddyServerSignals({
    enabled: envObserverEnabled(),
    dealId: state.dealId ?? null,
    onSignal: emit,
  });

  useBuddyFlightRecorder({
    enabled: envObserverEnabled() && state.role === "builder",
    runId: state.runId ?? null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onSignal(evt: Event) {
      const detail = (evt as CustomEvent).detail as BuddySignal | undefined;
      if (!detail) return;
      emit(detail);
    }

    window.addEventListener(eventName, onSignal as EventListener);
    return () => window.removeEventListener(eventName, onSignal as EventListener);
  }, [eventName, emit]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <BuddyPanel />
    </Ctx.Provider>
  );
}

function interpretSignal(signal: BuddySignal) {
  switch (signal.type) {
    case "checklist.updated": {
      const missing = Number(signal.payload?.missing ?? NaN);
      const received = Number(signal.payload?.received ?? NaN);
      if (Number.isFinite(missing) && missing > 0) {
        return {
          message: `We're close. ${missing} document${missing === 1 ? "" : "s"} still missing.`,
          tone: "encouraging",
        };
      }
      if (Number.isFinite(received)) {
        return { message: `Checklist updated. ${received} received.`, tone: "neutral" };
      }
      return { message: "Checklist updated.", tone: "neutral" };
    }
    case "user.action": {
      const action = String(signal.payload?.action ?? "");
      if (action === "start_underwriting") {
        return { message: "Starting underwriting. I'll monitor for issues.", tone: "focused" };
      }
      if (action) return { message: `Action: ${action}`, tone: "neutral" };
      return { message: "Action captured.", tone: "neutral" };
    }
    case "deal.loaded":
      return { message: "Deal context loaded. Watching changes.", tone: "neutral" };
    case "deal.ignited":
      return { message: "Deal intake started. I’m tracking incoming documents.", tone: "focused" };
    case "page.ready":
      return { message: "Page ready. Observer mode active.", tone: "neutral" };
    case "error":
      return { message: "Something went wrong. Check details.", tone: "caution" };
    default:
      return null;
  }
}

export function useBuddyContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("BuddyProvider missing");
  return ctx;
}
