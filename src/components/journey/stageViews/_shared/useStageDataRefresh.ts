"use client";

import { useEffect } from "react";
import { useStageDataContext } from "./StageDataProvider";

/**
 * Convenience hook — returns `refreshStageData` from the stage data context.
 */
export function useStageDataRefresh(): () => Promise<void> {
  return useStageDataContext().refreshStageData;
}

/**
 * Register a panel-local refresher with the stage data context. Re-registers
 * automatically when `fn` changes; unregisters on unmount.
 */
export function useRegisterStageRefresher(
  id: string,
  fn: () => Promise<void> | void,
): void {
  const { registerRefresher } = useStageDataContext();
  useEffect(() => {
    return registerRefresher(id, fn);
  }, [id, fn, registerRefresher]);
}
