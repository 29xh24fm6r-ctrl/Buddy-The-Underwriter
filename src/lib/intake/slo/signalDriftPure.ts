/**
 * Signal Drift — Pure Exports (Phase D)
 *
 * Pure constants and helpers extracted into a separate module so CI guards
 * can import them without pulling in writeEvent → server-only transitively.
 *
 * Imported by: detectSignalDrift.ts (re-exports), intakeSignalTelemetryGuard.test.ts
 *
 * Invariant (CI Guard 8): detectSignalDrift() accepts exactly one parameter —
 * the injected SupabaseClient. SIGNAL_DRIFT_EXPECTED_ARITY documents this
 * contract; the TypeScript type on detectSignalDrift.ts enforces it at
 * compile time.
 */

// ---------------------------------------------------------------------------
// Exported constants (stable — changing is a breaking change)
// ---------------------------------------------------------------------------

export const SIGNAL_DETECTION_VERSION = "signal_v1";
export const SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD = 0.10; // 10% week-over-week spike
export const SIGNAL_CONFIDENCE_DROP_THRESHOLD = 0.10;    // 10% week-over-week drop
export const SIGNAL_TOP_DOC_TYPES_COUNT = 3;             // monitor top-N doc types by volume
export const SIGNAL_MIN_SAMPLE_SIZE = 30;                // require ≥30 docs to emit

/**
 * CI Guard 8 invariant — detectSignalDrift() accepts exactly one parameter
 * (the injected SupabaseClient). If the function signature changes to accept
 * zero or >1 params, update this constant AND the TypeScript signature together.
 */
export const SIGNAL_DRIFT_EXPECTED_ARITY = 1;

// ---------------------------------------------------------------------------
// Exported pure helper (CI Guard 7)
// ---------------------------------------------------------------------------

/**
 * Pure helper — no DB, no IO, fully deterministic.
 * Compute LLM fallback percentage from source mix rows.
 * LLM fallback = match_source = 'ai_classification'
 */
export function computeLlmFallbackPct(
  rows: Array<{ match_source: string; doc_count: number }>,
): number {
  const total = rows.reduce((s, r) => s + r.doc_count, 0);
  if (total === 0) return 0;
  const llmCount = rows
    .filter((r) => r.match_source === "ai_classification")
    .reduce((s, r) => s + r.doc_count, 0);
  return llmCount / total;
}
