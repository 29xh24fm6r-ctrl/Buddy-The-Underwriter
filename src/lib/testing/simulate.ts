import type { DealMode } from "@/lib/deals/dealMode";

export type SimState = {
  mode?: DealMode;
  remainingCount?: number;
  processing?: boolean;
  blockedReason?: string;
};

export function applySimulation<T extends { mode: DealMode; detail?: string | null }>(
  real: T,
  sim?: SimState | null
): T {
  if (!sim) return real;

  const mode = sim.mode ?? real.mode;
  const detail =
    mode === "blocked"
      ? sim.blockedReason ?? real.detail ?? "Blocked"
      : real.detail ?? null;

  return { ...real, mode, detail };
}
