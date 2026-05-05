"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import type { AdvisorBlockerObservationInput } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";

/**
 * SPEC-10 — persists per-deal blocker observations.
 *
 * Stores `first_seen_at`, `last_seen_at`, `seen_count`, and `resolved_at`
 * server-side so the advisor's `stale_blocker` pattern detector can fire
 * across sessions and devices.
 *
 * Behavior:
 *   1. On mount and on every `blockers` change, POSTs the current set so
 *      the server stamps `last_seen_at` and increments `seen_count`.
 *   2. Reads observations back via GET; surfaces them as
 *      `AdvisorBlockerObservationInput[]` ready to feed the pure builder.
 *   3. Degrades silently if the table is missing — the advisor still
 *      runs (it just won't emit `stale_blocker` warnings).
 */

type ServerObservationRow = {
  id: string;
  blocker_key: string;
  blocker_kind?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  resolved_at?: string | null;
};

export type BlockerObservation = {
  blockerKey: string;
  blockerKind?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  resolvedAt?: string | null;
};

export type UseBlockerObservationsResult = {
  observations: BlockerObservation[];
  loading: boolean;
  error: string | null;
  /** Returns the observation list reshaped for the pure advisor builder. */
  asAdvisorInput: AdvisorBlockerObservationInput[];
  /** Manual refresh (rarely needed; the hook re-syncs on blocker changes). */
  refresh: () => Promise<void>;
};

function fromServerRow(row: ServerObservationRow): BlockerObservation {
  return {
    blockerKey: row.blocker_key,
    blockerKind: row.blocker_kind ?? null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: row.seen_count,
    resolvedAt: row.resolved_at ?? null,
  };
}

export function useBlockerObservations(
  dealId: string | null,
  blockers: LifecycleBlocker[] | undefined,
): UseBlockerObservationsResult {
  const [observations, setObservations] = useState<BlockerObservation[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(dealId));
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  /** Stable identity for the current blockers — avoids needless POSTs. */
  const blockerKey = useMemo(() => {
    if (!blockers) return "";
    return blockers.map((b) => b.code).sort().join("|");
  }, [blockers]);

  const post = useCallback(async (): Promise<void> => {
    if (!dealId) {
      setLoading(false);
      return;
    }
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const body = {
        blockers: (blockers ?? []).map((b) => ({
          key: b.code,
          kind: b.code,
        })),
      };
      const res = await fetch(
        `/api/deals/${encodeURIComponent(dealId)}/advisor/blocker-observations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as {
        ok?: boolean;
        observations?: ServerObservationRow[];
        error?: string;
      };
      if (!json?.ok) {
        // Server returned table_missing — degrade silently.
        if (json?.error === "table_missing") {
          setObservations([]);
          return;
        }
        setError(json?.error ?? "unknown_error");
        return;
      }
      setObservations((json.observations ?? []).map(fromServerRow));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "fetch_failed");
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  }, [dealId, blockers]);

  useEffect(() => {
    if (!dealId) return;
    void post();
    return () => {
      inflight.current?.abort();
    };
    // post() is recomputed when dealId or blockerKey changes; we depend on
    // blockerKey directly so a stable blocker set doesn't refetch on every
    // render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, blockerKey]);

  const asAdvisorInput: AdvisorBlockerObservationInput[] = useMemo(
    () =>
      observations
        .filter((o) => !o.resolvedAt)
        .map((o) => ({
          code: o.blockerKey,
          firstSeenAt: o.firstSeenAt,
        })),
    [observations],
  );

  return {
    observations,
    loading,
    error,
    asAdvisorInput,
    refresh: post,
  };
}
