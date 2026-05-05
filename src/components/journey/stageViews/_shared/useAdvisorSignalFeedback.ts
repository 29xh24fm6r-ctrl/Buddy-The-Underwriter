"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CockpitAdvisorSignal } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";

/**
 * SPEC-09 → SPEC-10 → SPEC-11 — banker feedback for advisor signals.
 *
 * SPEC-11 changes (vs SPEC-10):
 *   - Repeated-dismissal counter is now SERVER-side
 *     (buddy_advisor_feedback.dismiss_count). The browser no longer
 *     tracks it. The server auto-converts dismiss → 7d snooze when
 *     dismiss_count crosses 3 (reason="repeated_dismissal"). The hook
 *     simply POSTs `state="dismissed"`; the server decides whether the
 *     row ends up dismissed or auto-snoozed and returns the canonical
 *     row, which the hook merges into local state.
 *   - The SPEC-10 dismiss-count localStorage cache is no longer written.
 *     Any leftover entries from SPEC-10 are cleaned up on next load.
 *   - GET filters expired snoozes server-side (SPEC-11 §2).
 *
 * Persistence model (unchanged from SPEC-10):
 *   - Server-first: GET on mount; localStorage replaced with snapshot
 *     when ok=true.
 *   - Mutations POST/DELETE the server AND mirror to localStorage as an
 *     offline fallback.
 *   - Hook degrades gracefully when the server endpoint returns
 *     `{ ok: false, error: "table_missing" }`.
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
  /** SPEC-10 — populated when feedback was created by an automatic rule. */
  reason?: string;
  createdAt: string;
  /** SPEC-11 — server-side dismiss counter for repeated-dismissal logic. */
  dismissCount?: number;
  /** SPEC-11 — last dismissal timestamp from the server. */
  lastDismissedAt?: string;
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
const DISMISS_HISTORY_PREFIX = "buddy.advisor.dismiss-count.v1.";
const REPEATED_DISMISS_THRESHOLD = 3;
const REPEATED_DISMISS_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function storageKeyForDeal(dealId: string): string {
  return `${STORAGE_KEY_PREFIX}${dealId}`;
}

function dismissKeyForDeal(dealId: string): string {
  return `${DISMISS_HISTORY_PREFIX}${dealId}`;
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
    // localStorage failures are non-fatal.
  }
}

function readDismissCounts(dealId: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(dismissKeyForDeal(dealId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDismissCounts(
  dealId: string,
  counts: Record<string, number>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      dismissKeyForDeal(dealId),
      JSON.stringify(counts),
    );
  } catch {
    // ignore
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
    return { kind: "snooze_expired" };
  }
  return { kind: "visible" };
}

type ServerFeedbackRow = {
  signal_key: string;
  signal_kind: string;
  signal_source: string;
  state: AdvisorSignalFeedbackState;
  snoozed_until?: string | null;
  reason?: string | null;
  dismiss_count?: number | null;
  last_dismissed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function fromServerRow(
  row: ServerFeedbackRow,
  dealId: string,
): AdvisorSignalFeedback {
  return {
    signalKey: row.signal_key,
    dealId,
    state: row.state,
    until: row.snoozed_until ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    dismissCount: row.dismiss_count ?? 0,
    lastDismissedAt: row.last_dismissed_at ?? undefined,
  };
}

export function useAdvisorSignalFeedback(
  dealId: string,
): UseAdvisorSignalFeedbackResult {
  const [version, setVersion] = useState(0);

  const store = useMemo(
    () => readStore(dealId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dealId, version],
  );

  // SPEC-10: hydrate from server on mount. If the fetch succeeds and returns
  // ok=true, we replace localStorage with the server snapshot. If the server
  // fails (offline, table missing, auth lapse), we keep using localStorage.
  //
  // SPEC-11: also clean up the legacy dismiss-count localStorage cache
  // (the counter now lives on the server). Keeps the storage tidy for
  // bankers who carry SPEC-10-era state across sessions.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(dismissKeyForDeal(dealId));
    } catch {
      // ignore
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/deals/${encodeURIComponent(dealId)}/advisor/feedback`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          feedback?: ServerFeedbackRow[];
        };
        if (!json?.ok || cancelled) return;
        const next = new Map<string, AdvisorSignalFeedback>();
        for (const row of json.feedback ?? []) {
          next.set(row.signal_key, fromServerRow(row, dealId));
        }
        writeStore(dealId, next);
        setVersion((v) => v + 1);
      } catch {
        // server fetch failure → keep localStorage cache.
      } finally {
        hydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  // Reap expired snoozes locally on every render. The server cleans up
  // separately; this just keeps the local cache honest.
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

  const writeLocal = useCallback(
    (key: string, entry: AdvisorSignalFeedback) => {
      const fresh = readStore(dealId);
      fresh.set(key, entry);
      writeStore(dealId, fresh);
      setVersion((v) => v + 1);
    },
    [dealId],
  );

  const removeLocal = useCallback(
    (key: string) => {
      const fresh = readStore(dealId);
      fresh.delete(key);
      writeStore(dealId, fresh);
      setVersion((v) => v + 1);
    },
    [dealId],
  );

  const persistServer = useCallback(
    async (entry: {
      signalKey: string;
      signalKind: string;
      signalSource: string;
      state: AdvisorSignalFeedbackState;
      snoozedUntil?: string | null;
      reason?: string | null;
    }) => {
      try {
        await fetch(
          `/api/deals/${encodeURIComponent(dealId)}/advisor/feedback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(entry),
          },
        );
      } catch {
        // best-effort — localStorage is the durable fallback
      }
    },
    [dealId],
  );

  /**
   * SPEC-11 — POST to the server, then reconcile our local cache with the
   * server's response. The server may have promoted a `dismissed` request
   * to `snoozed` after the dismiss-count threshold; the local store needs
   * to reflect the canonical row.
   */
  const persistServerAndReconcile = useCallback(
    async (entry: {
      signalKey: string;
      signalKind: string;
      signalSource: string;
      state: AdvisorSignalFeedbackState;
      snoozedUntil?: string | null;
      reason?: string | null;
    }) => {
      try {
        const res = await fetch(
          `/api/deals/${encodeURIComponent(dealId)}/advisor/feedback`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(entry),
          },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          feedback?: ServerFeedbackRow | null;
        };
        if (!json?.ok || !json.feedback) return;
        // Server may have flipped dismissed → snoozed. Mirror canonical.
        writeLocal(entry.signalKey, fromServerRow(json.feedback, dealId));
      } catch {
        // best-effort
      }
    },
    [dealId, writeLocal],
  );

  const removeServer = useCallback(
    async (key: string) => {
      try {
        await fetch(
          `/api/deals/${encodeURIComponent(
            dealId,
          )}/advisor/feedback/${encodeURIComponent(key)}`,
          { method: "DELETE" },
        );
      } catch {
        // best-effort
      }
    },
    [dealId],
  );

  const acknowledge = useCallback(
    (signal: CockpitAdvisorSignal) => {
      const key = signalKey(dealId, signal);
      writeLocal(key, {
        signalKey: key,
        dealId,
        state: "acknowledged",
        createdAt: new Date().toISOString(),
      });
      void persistServer({
        signalKey: key,
        signalKind: signal.kind,
        signalSource: signal.source,
        state: "acknowledged",
      });
    },
    [dealId, writeLocal, persistServer],
  );

  const snoozeRaw = useCallback(
    (signal: CockpitAdvisorSignal, durationMs: number, reason?: string) => {
      const key = signalKey(dealId, signal);
      const until = new Date(Date.now() + Math.max(durationMs, 0)).toISOString();
      writeLocal(key, {
        signalKey: key,
        dealId,
        state: "snoozed",
        until,
        reason,
        createdAt: new Date().toISOString(),
      });
      void persistServer({
        signalKey: key,
        signalKind: signal.kind,
        signalSource: signal.source,
        state: "snoozed",
        snoozedUntil: until,
        reason: reason ?? null,
      });
    },
    [dealId, writeLocal, persistServer],
  );

  const dismiss = useCallback(
    (signal: CockpitAdvisorSignal) => {
      const key = signalKey(dealId, signal);

      // SPEC-11: server tracks dismiss_count and auto-snoozes at threshold.
      // The browser writes a tentative dismissed entry and re-syncs from
      // the server response (which may flip the row to snoozed).
      writeLocal(key, {
        signalKey: key,
        dealId,
        state: "dismissed",
        createdAt: new Date().toISOString(),
      });
      void persistServerAndReconcile({
        signalKey: key,
        signalKind: signal.kind,
        signalSource: signal.source,
        state: "dismissed",
      });
    },
    [dealId, writeLocal, persistServerAndReconcile],
  );

  const snooze = useCallback(
    (signal: CockpitAdvisorSignal, durationMs: number) => {
      snoozeRaw(signal, durationMs);
    },
    [snoozeRaw],
  );

  const clear = useCallback(
    (signal: CockpitAdvisorSignal) => {
      const key = signalKey(dealId, signal);
      removeLocal(key);
      void removeServer(key);
      // SPEC-11: dismiss_count lives server-side now and is reset by
      // the DELETE handler (the row is removed entirely, taking the
      // counter with it). The legacy localStorage counter is cleaned
      // up on hook mount; nothing to do here.
    },
    [dealId, removeLocal, removeServer],
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
    window.localStorage.removeItem(dismissKeyForDeal(dealId));
  } catch {
    // ignore
  }
}

/** Test-only: configurable threshold inspector. */
export const __SPEC10 = {
  REPEATED_DISMISS_THRESHOLD,
  REPEATED_DISMISS_SNOOZE_MS,
  STORAGE_KEY_PREFIX,
  DISMISS_HISTORY_PREFIX,
};
