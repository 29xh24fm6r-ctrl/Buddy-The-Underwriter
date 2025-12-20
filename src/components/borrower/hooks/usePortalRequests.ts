// src/components/borrower/hooks/usePortalRequests.ts
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PortalRequestsResponse } from "@/lib/borrower/portalTypes";

type State =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: PortalRequestsResponse; error: null }
  | { status: "error"; data: null; error: string };

export function usePortalRequests(token: string) {
  const [state, setState] = useState<State>({ status: "idle", data: null, error: null });

  const load = useCallback(async () => {
    if (!token) return;
    setState({ status: "loading", data: null, error: null });

    try {
      const res = await fetch(`/api/borrower/portal/${encodeURIComponent(token)}/requests`, {
        method: "GET",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      });

      const json = (await res.json()) as PortalRequestsResponse;

      if (!res.ok || !json?.ok) {
        throw new Error((json as any)?.error || `Failed to load portal data (${res.status})`);
      }

      setState({ status: "ready", data: json, error: null });
    } catch (e: any) {
      setState({ status: "error", data: null, error: e?.message || "Failed to load portal data" });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(() => {
    if (state.status !== "ready") return null;

    const suggestions = (state.data.packSuggestions || [])
      .slice()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    const best = suggestions[0] || null;

    const missingItems = (state.data.missingItems || []).slice();

    // best-effort sorting: priority HIGH -> MEDIUM -> LOW, then title
    const prRank = (p?: string | null) => {
      const v = String(p || "").toUpperCase();
      if (v === "HIGH") return 0;
      if (v === "MEDIUM") return 1;
      if (v === "LOW") return 2;
      return 3;
    };

    missingItems.sort((a, b) => {
      const ar = prRank(a.priority);
      const br = prRank(b.priority);
      if (ar !== br) return ar - br;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });

    return {
      suggestions,
      bestSuggestion: best,
      progress: state.data.progress || null,
      requests: state.data.requests || [],
      deal: state.data.deal || null,
      missingItems,
      recentActivity: state.data.recentActivity || [],
    };
  }, [state]);

  return { state, load, derived };
}
