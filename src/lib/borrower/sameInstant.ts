/**
 * Compare two timestamp strings by the instant they denote, not by their
 * spelling.
 *
 * A JavaScript `toISOString()` value ends in `Z` with millisecond precision
 * (`2026-09-10T07:00:03.498Z`); PostgREST returns the same timestamptz as
 * `2026-09-10T07:00:03.498+00:00`, and trims trailing zeros from the
 * fractional part. A string comparison between the two is never equal, so a
 * write proven by the returned row was still reported as a concurrent
 * conflict. Anything unparseable compares unequal.
 */
export function isSameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta === tb;
}
