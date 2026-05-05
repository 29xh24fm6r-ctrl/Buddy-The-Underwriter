"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CockpitAdvisorSignal } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";

/**
 * SPEC-09 — banker feedback for advisor signals.
 *
 * Stored in localStorage only. No backend persistence yet — that's a
 * later step once we know what bankers actually dismiss vs snooze.
 *
 * Keys are stable across renders (see signalKey()) so a refresh does not
 * lose prior feedback.
 */

export type AdvisorSignalFeedbackState =
  | "acknowledged"
  | "dismissed"
  | "snoozed";

export type AdvisorSignalFeedback = {
  signalKey: string;
  dealId: string;
  state: AdvisorSignalFeedbackState;
  /** ISO timestamp when a snoozed signal becomes visible again. */
  until?: string;
  createdAt: string;
};

/**
 * Stable signal key. Anchors to the deal and the rendered semantics so
 * a banker who dismisses "Document readiness 40%" doesn't also dismiss
 * a future risk_warning with the same title.
 */
export function signalKey(dealId: string, signal: CockpitAdvisorSignal): string {
  return `${dealId}|${signal.kind}|${signal.source}|${signal.title}`;
}

const STORAGE_KEY_PREFIX = "buddy.advisor.feedback.v1.";

function storageKeyForDeal(dealId: string): string {
  return `${STORAGE_KEY_PREFIX}${dealId}`;
}

function readStore(dealId: string): Map<string, AdvisorSignalFeedback> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(storageKeyForDeal(dealId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as AdvisorSignalFeedback[];
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.map((entry) => [entry.signalKey, entry]));
  } catch {
    return new Map();
  }
}

function writeStore(
  dealId: string,
  store: Map<string, AdvisorSignalFeedback>,
): void {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(store.values());
    window.localStorage.setItem(storageKeyForDeal(dealId), JSON.stringify(arr));
  } catch {
    // localStorage failures are non-fatal — the advisor still works
    // without persistence.
  }
}

export type UseAdvisorSignalFeedbackResult = {
  /** Live snapshot of feedback by signalKey. */
  feedback: ReadonlyMap<string, AdvisorSignalFeedback>;
  acknowledge: (signal: CockpitAdvisorSignal) => void;
  dismiss: (signal: CockpitAdvisorSignal) => void;
  snooze: (signal: CockpitAdvisorSignal, durationMs: number) => void;
  clear: (signal: CockpitAdvisorSignal) => void;
  /** Compute effective visibility for a signal (deterministic). */
  effectiveStateFor: (
    signal: CockpitAdvisorSignal,
    now?: number,
  ) => AdvisorSignalEffectiveState;
};

export type AdvisorSignalEffectiveState =
  | { kind: "visible" }
  | { kind: "acknowledged" }
  | { kind: "hidden_dismissed" }
  | { kind: "hidden_snoozed"; until: string }
  | { kind: "snooze_expired" };

/**
 * Pure helper exposed for tests and the panel — given a feedback entry
 * and a clock, what's the effective state?
 */
export function deriveEffectiveState(
  entry: AdvisorSignalFeedback | undefined,
  now: number,
): AdvisorSignalEffectiveState {
  if (!entry) return { kind: "visible" };
  if (entry.state === "dismissed") return { kind: "hidden_dismissed" };
  if (entry.state === "acknowledged") return { kind: "acknowledged" };
  if (entry.state === "snoozed") {
    const until = entry.until ?? null;
    if (until && new Date(until).getTime() > now) {
      return { kind: "hidden_snoozed", until };
    }
    // Snooze elapsed — surface as visible again. The reaper logic in
    // useAdvisorSignalFeedback removes the entry on next render.
    return { kind: "snooze_expired" };
  }
  return { kind: "visible" };
}

export function useAdvisorSignalFeedback(
  dealId: string,
): UseAdvisorSignalFeedbackResult {
  const [version, setVersion] = useState(0);

  const store = useMemo(
    () => readStore(dealId),
    // dealId change rebuilds the snapshot; bumping `version` forces a
    // fresh read after writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealId, version],
  );

  // Reap expired snoozes on every render the panel triggers.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    let mutated = false;
    for (const [key, entry] of store) {
      if (
        entry.state === "snoozed" &&
        entry.until &&
        new Date(entry.until).getTime() <= now
      ) {
        store.delete(key);
        mutated = true;
      }
    }
    if (mutated) {
      writeStore(dealId, store);
      setVersion((v) => v + 1);
    }
  }, [dealId, store]);

  const update = useCallback(
    (
      key: string,
      next: Omit<AdvisorSignalFeedback, "signalKey" | "dealId" | "createdAt">,
    ) => {
      const fresh = readStore(dealId);
      fresh.set(key, {
        signalKey: key,
        dealId,
        createdAt: new Date().toISOString(),
        ...next,
      });
      writeStore(dealId, fresh);
      setVersion((v) => v + 1);
    },
    [dealId],
  );

  const acknowledge = useCallback(
    (signal: CockpitAdvisorSignal) => {
      update(signalKey(dealId, signal), { state: "acknowledged" });
    },
    [dealId, update],
  );

  const dismiss = useCallback(
    (signal: CockpitAdvisorSignal) => {
      update(signalKey(dealId, signal), { state: "dismissed" });
    },
    [dealId, update],
  );

  const snooze = useCallback(
    (signal: CockpitAdvisorSignal, durationMs: number) => {
      const until = new Date(Date.now() + Math.max(durationMs, 0)).toISOString();
      update(signalKey(dealId, signal), { state: "snoozed", until });
    },
    [dealId, update],
  );

  const clear = useCallback(
    (signal: CockpitAdvisorSignal) => {
      const fresh = readStore(dealId);
      fresh.delete(signalKey(dealId, signal));
      writeStore(dealId, fresh);
      setVersion((v) => v + 1);
    },
    [dealId],
  );

  const effectiveStateFor = useCallback(
    (signal: CockpitAdvisorSignal, now?: number) =>
      deriveEffectiveState(
        store.get(signalKey(dealId, signal)),
        now ?? Date.now(),
      ),
    [dealId, store],
  );

  return { feedback: store, acknowledge, dismiss, snooze, clear, effectiveStateFor };
}

/** Test-only: reset the localStorage store for a deal. */
export function __resetAdvisorFeedbackForTests(dealId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKeyForDeal(dealId));
  } catch {
    // ignore
  }
}
