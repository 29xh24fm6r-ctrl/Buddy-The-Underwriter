/**
 * SPEC-12 — advisor evidence model.
 *
 * Predictive and decision-quality advisor signals must cite the
 * deterministic facts that produced them. The shape is intentionally
 * minimal — string label + optional value/severity — so any UI or
 * downstream LLM explanation layer can render it without inventing
 * facts.
 *
 * Rules:
 *   - `source` is restricted to a closed enum (mirrors
 *     CockpitAdvisorSignalSource + "decision").
 *   - The evidence list is the source of truth for "why this matters";
 *     LLM explanations may rephrase but never add new facts.
 */

export type AdvisorEvidenceSource =
  | "lifecycle"
  | "blockers"
  | "conditions"
  | "overrides"
  | "memo"
  | "documents"
  | "telemetry"
  | "decision";

export type AdvisorEvidenceSeverity = "info" | "warning" | "critical";

export type AdvisorEvidence = {
  source: AdvisorEvidenceSource;
  /** Short human-readable label, e.g. "Memo gaps". */
  label: string;
  /** Optional value associated with the label (count, flag, name). */
  value?: string | number | boolean;
  /** Optional severity for the evidence row itself. */
  severity?: AdvisorEvidenceSeverity;
};

const ALLOWED_SOURCES: ReadonlySet<AdvisorEvidenceSource> = new Set([
  "lifecycle",
  "blockers",
  "conditions",
  "overrides",
  "memo",
  "documents",
  "telemetry",
  "decision",
]);

/**
 * Runtime guard — used by the panel and explanation layer to reject any
 * evidence row whose source escapes the canonical enum. Returns the
 * input unchanged when valid; throws in dev so a typo is visible.
 */
export function assertEvidenceSource(
  source: string,
): asserts source is AdvisorEvidenceSource {
  if (!ALLOWED_SOURCES.has(source as AdvisorEvidenceSource)) {
    throw new Error(`AdvisorEvidence: unknown source "${source}"`);
  }
}

export function isAdvisorEvidence(value: unknown): value is AdvisorEvidence {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.label !== "string") return false;
  if (typeof v.source !== "string") return false;
  return ALLOWED_SOURCES.has(v.source as AdvisorEvidenceSource);
}
