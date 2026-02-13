/**
 * Spread Rendering Error Taxonomy
 *
 * Structured error codes for spread state machine.
 * Used by spreadsProcessor catch block + renderSpread error paths.
 */

export type SpreadErrorCode =
  | "TEMPLATE_NOT_FOUND"
  | "MISSING_UPSTREAM_FACTS"
  | "INSUFFICIENT_PERIOD_DATA"
  | "RENDER_EXCEPTION"
  | "TIMEOUT"
  | "DEPENDENCY_STALE"
  | "LEGACY";

/**
 * Classify a thrown error into a structured SpreadErrorCode.
 */
export function classifySpreadError(err: unknown): SpreadErrorCode {
  if (!(err instanceof Error)) return "RENDER_EXCEPTION";
  const msg = err.message.toLowerCase();
  if (msg.includes("timeout") || msg.includes("timed out")) return "TIMEOUT";
  if (msg.includes("template") || msg.includes("not found")) return "TEMPLATE_NOT_FOUND";
  return "RENDER_EXCEPTION";
}
