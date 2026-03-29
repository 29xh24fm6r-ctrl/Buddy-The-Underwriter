"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import type { ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CockpitStateDeal = {
  id: string;
  dealName: string;
  borrower: { id: string; legalName: string } | null;
  bank: { id: string; name: string } | null;
  lifecycleStage: string;
};

export type CockpitStateRequirement = {
  code: string;
  label: string;
  group: string;
  required: boolean;
  checklistStatus: "missing" | "received" | "satisfied" | "waived";
  readinessStatus: "blocking" | "warning" | "complete" | "optional";
  matchedDocumentIds: string[];
  matchedYears: number[];
  reasons: string[];
};

export type CockpitStateBlocker = {
  code: string;
  severity: "blocking" | "warning";
  title: string;
  details: string[];
  actionLabel: string;
};

export type CockpitStateReadiness = {
  percent: number;
  categories: Array<{
    code: string;
    status: "blocking" | "warning" | "complete";
  }>;
};

export type CockpitState = {
  deal: CockpitStateDeal;
  documentState: {
    requirements: CockpitStateRequirement[];
    computedAt: string | null;
  };
  readiness: CockpitStateReadiness;
  blockers: CockpitStateBlocker[];
};

type CockpitStateHook = {
  state: CockpitState | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCockpitState(dealId: string): CockpitStateHook {
  const [state, setState] = useState<CockpitState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/deals/${dealId}/cockpit-state`);
      if (!resp.ok) {
        throw new Error(`cockpit-state fetch failed: ${resp.status}`);
      }
      const data = await resp.json();
      if (data.ok) {
        setState({
          deal: data.deal,
          documentState: data.documentState ?? { requirements: [], computedAt: null },
          readiness: data.readiness ?? { percent: 0, categories: [] },
          blockers: data.blockers ?? [],
        });
      } else {
        throw new Error(data.error ?? "Unknown cockpit-state error");
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  return { state, loading, error, refetch: fetchState };
}

// ─── Context (for sharing across panels without prop drilling) ────────────────

const CockpitStateContext = createContext<CockpitStateHook>({
  state: null,
  loading: true,
  error: null,
  refetch: () => {},
});

export function CockpitStateProvider({
  dealId,
  children,
}: {
  dealId: string;
  children: ReactNode;
}) {
  const hook = useCockpitState(dealId);
  return (
    <CockpitStateContext.Provider value={hook}>
      {children}
    </CockpitStateContext.Provider>
  );
}

export function useCockpitStateContext(): CockpitStateHook {
  return useContext(CockpitStateContext);
}
