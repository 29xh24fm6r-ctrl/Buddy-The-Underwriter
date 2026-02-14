import type { SpreadType } from "@/lib/financialSpreads/types";

/**
 * Normalize DB-stored spread_type to canonical TypeScript value.
 * Legacy "MOODYS" rows map to "STANDARD" — no SQL migration needed.
 */
export function normalizeSpreadType(raw: string): SpreadType {
  if (raw === "MOODYS") return "STANDARD";
  return raw as SpreadType;
}
