"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LifecycleBlocker } from "@/buddy/lifecycle/model";
import type { AdvisorBlockerObservationInput } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";

/**
 * SPEC-10 → SPEC-11 — persists per-deal blocker observations.
 *
 * Stores `first_seen_at`, `last_seen_at`, `seen_count`, and `resolved_at`
 * server-side so the advisor's `stale_blocker` pattern detector can fire
 * across sessions and devices.
 *
 * SPEC-11 changes:
 *   - 250ms debounce on POST so a deal that flickers between blocker
 *     states during ingest doesn't generate one round-trip per flicker.
 *   - Sorted-key dedupe: if the new blocker set is identical to the
 *     last-POSTed set, the request is skipped entirely.
 *
 * Behavior:
 *   1. On mount and on every distinct blocker-set change, debounces for
 *      250ms then POSTs once.
 *   2. Server upserts each key (incrementing seen_count) and stamps
 *      resolved_at on missing keys.
 *   3. Surfaces `asAdvisorInput` as { code, firstSeenAt }[] ready to
 *      feed the pure stale_blocker detector.
 *   4. Degrades silently when the table is missing — the advisor still
 *      runs without stale_blocker warnings.
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

  /** SPEC-11: stable sorted-key identity for the current blockers; the
   *  POST handler reads `lastPostedKey` to dedupe identical sets. */
  const blockerKey = useMemo(() => {
    if (!blockers) return "";
    return blockers.map((b) => b.code).sort().join("|");
  }, [blockers]);
  const lastPostedKey = useRef<string | null>(null);

  const post = useCallback(async (): Promise<void> => {
    if (!dealId) {
      setLoading(false);
      return;
    }
    // SPEC-11 dedupe: skip the POST when the blocker set hasn't changed.
    if (lastPostedKey.current === blockerKey) {
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
      lastPostedKey.current = blockerKey;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "fetch_failed");
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  }, [dealId, blockers, blockerKey]);

  useEffect(() => {
    if (!dealId) return;
    // SPEC-11 — 250ms debounce. A deal that flickers between blocker
    // states during ingest only generates one POST every 250ms.
    const t = setTimeout(() => {
      void post();
    }, 250);
    return () => {
      clearTimeout(t);
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
