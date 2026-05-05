"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

/**
 * SPEC-04 — stage-level refresh / mutation context.
 *
 * Stage views own shared data; panels render data; cockpit actions mutate
 * data; this context refreshes data after a successful action. Internally
 * combines a registry of refresh callbacks with `router.refresh()` so any
 * Server Component above the stage view also re-renders.
 *
 * SPEC-05: tracks `lastRefreshedAt` (ms epoch, 0 if never) so consumers can
 * display freshness; tracks `refreshSeq` so client components that don't
 * own data via useStageJsonResource can use it as a remount key when
 * router.refresh alone is insufficient.
 */
export type StageDataRefreshContext = {
  /** Re-run all registered refreshers, then router.refresh(). */
  refreshStageData: () => Promise<void>;
  /** Register a refresher (typically called by a stage view's effect). */
  registerRefresher: (id: string, fn: () => Promise<void> | void) => () => void;
  /** Monotonic counter that bumps after every successful refresh. */
  refreshSeq: number;
  /** Epoch ms of last successful refresh; 0 if never refreshed. */
  lastRefreshedAt: number;
};

const Context = createContext<StageDataRefreshContext | null>(null);

export function StageDataProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const refreshersRef = useRef<Map<string, () => Promise<void> | void>>(new Map());
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(0);

  const registerRefresher = useCallback(
    (id: string, fn: () => Promise<void> | void) => {
      refreshersRef.current.set(id, fn);
      return () => {
        if (refreshersRef.current.get(id) === fn) {
          refreshersRef.current.delete(id);
        }
      };
    },
    [],
  );

  const refreshStageData = useCallback(async () => {
    const fns = Array.from(refreshersRef.current.values());
    await Promise.all(
      fns.map(async (fn) => {
        try {
          await fn();
        } catch {
          // swallow per-refresher failures so a single bad panel can't
          // gate the whole refresh
        }
      }),
    );
    setRefreshSeq((n) => n + 1);
    setLastRefreshedAt(Date.now());
    try {
      router.refresh();
    } catch {
      // router.refresh isn't expected to throw, but be defensive
    }
  }, [router]);

  const value = useMemo<StageDataRefreshContext>(
    () => ({ refreshStageData, registerRefresher, refreshSeq, lastRefreshedAt }),
    [refreshStageData, registerRefresher, refreshSeq, lastRefreshedAt],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useStageDataContext(): StageDataRefreshContext {
  const ctx = useContext(Context);
  if (!ctx) {
    // No-op fallback — avoids crashing stage views rendered outside the
    // provider (e.g. in tests). Callers can safely await refreshStageData().
    return {
      refreshStageData: async () => {},
      registerRefresher: () => () => {},
      refreshSeq: 0,
      lastRefreshedAt: 0,
    };
  }
  return ctx;
}
