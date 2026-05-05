"use client";

import { useEffect } from "react";
import {
  useStageDataContext,
  type StageRefreshScope,
  type StageRefreshOptions,
} from "./StageDataProvider";

/**
 * Convenience hook — returns `refreshStageData` from the stage data context.
 *
 * SPEC-06: accepts an optional scope argument.
 * SPEC-07: scoped refreshes are strict by default; pass
 *   `{ includeGlobal: true }` to also drain the legacy "all" bucket.
 */
export function useStageDataRefresh(): (
  scope?: StageRefreshScope,
  options?: StageRefreshOptions,
) => Promise<void> {
  return useStageDataContext().refreshStageData;
}

/**
 * Register a panel-local refresher with the stage data context.
 *
 * SPEC-06: accepts a scope as the first argument so a single mutation can
 * refresh only its bucket. The legacy two-arg shape `(id, fn)` is still
 * supported and registers the refresher under the "all" bucket.
 *
 * Usage:
 *   useRegisterStageRefresher("conditions", "decision:conditions", refreshFn);
 *   useRegisterStageRefresher("documents:remount", () => {});  // legacy
 */
export function useRegisterStageRefresher(
  scopeOrId: StageRefreshScope | string,
  idOrFn: string | (() => Promise<void> | void),
  fn?: () => Promise<void> | void,
): void {
  const { registerRefresher } = useStageDataContext();
  useEffect(() => {
    return registerRefresher(scopeOrId, idOrFn, fn);
  }, [scopeOrId, idOrFn, fn, registerRefresher]);
}
