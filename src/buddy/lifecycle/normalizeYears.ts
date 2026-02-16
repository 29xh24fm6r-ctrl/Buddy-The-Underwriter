/**
 * Strict deterministic normalizer for year arrays at the API boundary.
 *
 * Accepts whatever the upstream computation produced (including corrupted
 * shapes from stale caches or serialization bugs) and returns a clean,
 * sorted, deduplicated number[] — or [] if the input is not an array.
 *
 * Rules:
 *  - Non-array input → []
 *  - Each element: coerce string→parseInt, keep number, reject everything else
 *  - Drop NaN / non-integer / fractional
 *  - Deduplicate
 *  - Sort ascending
 */
export function normalizeYearArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<number>();
  const result: number[] = [];

  for (const item of raw) {
    const n =
      typeof item === "number"
        ? item
        : typeof item === "string"
          ? parseInt(item, 10)
          : NaN;

    if (Number.isFinite(n) && Number.isInteger(n) && !seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }

  return result.sort((a, b) => a - b);
}
