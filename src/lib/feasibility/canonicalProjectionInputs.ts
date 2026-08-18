/**
 * Read decision inputs already computed by the canonical SBA projection
 * engine. Feasibility is a consumer of these values; it must never recreate
 * capitalization math with a second formula.
 */

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ratio(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function readCanonicalEquityInjectionPct(
  sourcesAndUses: unknown,
): number | null {
  const payload = record(sourcesAndUses);
  if (!payload) return null;

  const canonicalEquity = record(payload.equityInjection);
  const canonicalPct = ratio(canonicalEquity?.actualPct);
  if (canonicalPct != null) return canonicalPct;

  // Read compatibility for packages produced before the canonical engine
  // nested its equity result. This is still a direct read, never a re-derive.
  return ratio(payload.equityInjectionPct);
}
