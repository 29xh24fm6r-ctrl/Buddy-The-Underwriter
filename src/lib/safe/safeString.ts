/**
 * Crash-proof string coercion for UI rendering.
 *
 * INVARIANT: Cockpit UI must NEVER throw runtime errors from undefined data.
 * All derived display fields must pass through safeString() or equivalent.
 */

/** Coerce unknown value to string with fallback. Never throws. */
export function safeString(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

/** Coerce unknown value to number with fallback. Never throws. */
export function safeNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Format a stage/phase slug for display: "PROCESSING_COMPLETE" → "Processing Complete" */
export function formatStageLabel(v: unknown, fallback = "Unknown"): string {
  const raw = safeString(v, fallback);
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || fallback;
}
