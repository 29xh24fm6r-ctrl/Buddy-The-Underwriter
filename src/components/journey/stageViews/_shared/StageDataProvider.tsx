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
 *
 * SPEC-06: refreshers are bucketed by `StageRefreshScope`. A scoped call
 * like `refreshStageData("conditions")` runs only conditions-scoped
 * refreshers, leaving the rest of the stage's data untouched. The default
 * (`"all"` or no argument) runs every refresher across every scope.
 */

export type StageRefreshScope =
  | "all"
  | "documents"
  | "underwriting"
  | "memo"
  | "decision"
  | "conditions"
  | "overrides"
  | "closing";

const KNOWN_SCOPES: ReadonlySet<StageRefreshScope> = new Set([
  "all",
  "documents",
  "underwriting",
  "memo",
  "decision",
  "conditions",
  "overrides",
  "closing",
]);

export type StageRefreshOptions = {
  /**
   * SPEC-07: when true, scoped refreshes also drain the catch-all "all"
   * bucket (legacy SPEC-06 behavior). False by default — scoped refreshes
   * are strict.
   */
  includeGlobal?: boolean;
};

export type StageDataRefreshContext = {
  /**
   * Re-run registered refreshers, then router.refresh().
   *
   * SPEC-07 contract:
   *   refreshStageData()                 → "all" (legacy)
   *   refreshStageData("all")            → every refresher across every bucket
   *   refreshStageData("conditions")     → conditions bucket ONLY
   *   refreshStageData("conditions",
   *                    { includeGlobal: true })
   *                                      → conditions + "all" (opt-in)
   *
   * Unknown scopes fall back to "all" without crashing.
   */
  refreshStageData: (
    scope?: StageRefreshScope,
    options?: StageRefreshOptions,
  ) => Promise<void>;
  /**
   * Register a refresher under a scope. The first arg is the scope (e.g.
   * "conditions") so a single mutation can refresh only that bucket.
   * For backward compat with SPEC-04/SPEC-05, when only `(id, fn)` is
   * passed, the refresher is registered under the catch-all "all" bucket.
   */
  registerRefresher: (
    scopeOrId: StageRefreshScope | string,
    idOrFn: string | (() => Promise<void> | void),
    fn?: () => Promise<void> | void,
  ) => () => void;
  /** Monotonic counter that bumps after every successful refresh. */
  refreshSeq: number;
  /** Epoch ms of last successful refresh; 0 if never refreshed. */
  lastRefreshedAt: number;
};

const Context = createContext<StageDataRefreshContext | null>(null);

type Bucket = Map<string, () => Promise<void> | void>;

export function StageDataProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // refreshers[scope][id] → fn. "all" is the catch-all bucket.
  const bucketsRef = useRef<Map<StageRefreshScope, Bucket>>(new Map());
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(0);

  const getBucket = useCallback((scope: StageRefreshScope): Bucket => {
    let b = bucketsRef.current.get(scope);
    if (!b) {
      b = new Map();
      bucketsRef.current.set(scope, b);
    }
    return b;
  }, []);

  const registerRefresher: StageDataRefreshContext["registerRefresher"] =
    useCallback(
      (scopeOrId, idOrFn, fn) => {
        let scope: StageRefreshScope;
        let id: string;
        let refresher: () => Promise<void> | void;

        if (typeof idOrFn === "function") {
          // Backward-compat shape: register(id, fn) → "all" bucket.
          scope = "all";
          id = String(scopeOrId);
          refresher = idOrFn;
        } else {
          // New shape: register(scope, id, fn).
          scope = (scopeOrId as StageRefreshScope) ?? "all";
          id = String(idOrFn);
          refresher = fn ?? (() => {});
        }

        const bucket = getBucket(scope);
        bucket.set(id, refresher);
        return () => {
          const current = getBucket(scope);
          if (current.get(id) === refresher) current.delete(id);
        };
      },
      [getBucket],
    );

  const refreshStageData: StageDataRefreshContext["refreshStageData"] =
    useCallback(
      async (scope?: StageRefreshScope, options?: StageRefreshOptions) => {
        const requested: StageRefreshScope =
          scope === undefined
            ? "all"
            : KNOWN_SCOPES.has(scope)
              ? scope
              : "all";

        const fns: Array<() => Promise<void> | void> = [];
        if (requested === "all") {
          // Drain every bucket.
          for (const b of bucketsRef.current.values()) {
            for (const fn of b.values()) fns.push(fn);
          }
        } else {
          // SPEC-07: scoped refreshes are strict by default. The "all"
          // bucket only joins when the caller opts in via includeGlobal.
          const specific = bucketsRef.current.get(requested);
          if (specific) for (const fn of specific.values()) fns.push(fn);
          if (options?.includeGlobal) {
            const all = bucketsRef.current.get("all");
            if (all) for (const fn of all.values()) fns.push(fn);
          }
        }

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
      },
      [router],
    );

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
