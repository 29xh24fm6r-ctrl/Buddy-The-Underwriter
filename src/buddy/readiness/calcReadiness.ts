import type { BuddyContextPack } from "@/buddy/brain/types";

export interface ReadinessBreakdown {
  readinessPct: number;
  received?: number;
  missing?: number;
  total?: number;
  blockers?: string[];
  updatedAt: number;
}

export function calcReadiness(ctx: BuddyContextPack): ReadinessBreakdown | null {
  const c: any = ctx.checklist;
  if (!c) return null;

  const received = typeof c.received === "number" ? c.received : undefined;
  const missing = typeof c.missing === "number" ? c.missing : undefined;
  const total =
    typeof received === "number" && typeof missing === "number"
      ? received + missing
      : typeof c.total === "number"
        ? c.total
        : undefined;

  const pct =
    typeof received === "number" && typeof total === "number" && total > 0
      ? Math.max(0, Math.min(100, Math.round((received / total) * 100)))
      : 0;

  const blockers =
    Array.isArray(c.missingKeys) && c.missingKeys.length ? c.missingKeys.slice(0, 4) : undefined;

  return {
    readinessPct: pct,
    received,
    missing,
    total,
    blockers,
    updatedAt: Date.now(),
  };
}
