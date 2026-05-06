/**
 * SPEC-12 — optional LLM-rewritten explanation layer.
 *
 * Strict guardrails:
 *   - Only invoked behind `NEXT_PUBLIC_ENABLE_ADVISOR_EXPLANATIONS=true`.
 *   - LLM cannot generate signal logic; it only rewrites the deterministic
 *     explanation derived from `signal.evidence` + `predictionReason`.
 *   - Source-of-truth remains the signal itself.
 *   - On any failure (network, parse, flag off), falls back to the
 *     deterministic explanation built from evidence.
 *
 * The deterministic fallback is what the panel shows by default. The
 * LLM path is a future enhancement; today this file is a pure helper
 * that returns the deterministic explanation.
 */
import type { AdvisorEvidence } from "./evidence";
import type { CockpitAdvisorSignal } from "./buildCockpitAdvisorSignals";

export type AdvisorExplanation = {
  /** Short headline — usually 1 line. */
  headline: string;
  /** 1-2 sentence "why this matters" body. */
  body: string;
  /** Source of the explanation: "deterministic" today; "llm" if the
   *  LLM path ran successfully. */
  source: "deterministic" | "llm";
  /** Always echoes back the deterministic evidence used. LLM path
   *  cannot strip or add evidence. */
  evidence: AdvisorEvidence[];
};

const FLAG_NAME = "NEXT_PUBLIC_ENABLE_ADVISOR_EXPLANATIONS";

export function isAdvisorExplanationEnabled(
  env: Record<string, string | undefined> = (typeof process !== "undefined"
    ? process.env
    : {}) as Record<string, string | undefined>,
): boolean {
  return env[FLAG_NAME] === "true";
}

function deterministicHeadlineFor(signal: CockpitAdvisorSignal): string {
  // The signal.title is already deterministic and copy-fit; reuse it.
  return signal.title;
}

function deterministicBodyFor(signal: CockpitAdvisorSignal): string {
  const evidence = signal.evidence ?? [];
  if (evidence.length === 0) {
    return signal.detail ?? signal.rankReason;
  }
  const sentences: string[] = [];
  if (signal.detail) sentences.push(signal.detail);
  const keyEvidence = evidence
    .slice(0, 3)
    .map((ev) => {
      const valuePart = ev.value !== undefined ? ` (${ev.value})` : "";
      return `${ev.label}${valuePart}`;
    })
    .join(" · ");
  if (keyEvidence) sentences.push(`Evidence: ${keyEvidence}.`);
  return sentences.join(" ");
}

/**
 * Pure deterministic explanation — never calls fetch.
 *
 * The LLM path is a future enhancement. When the feature flag goes on,
 * an async wrapper can call out to the gateway, then fall back to this
 * function on failure. The panel and tests use this synchronous form.
 */
export function buildDeterministicAdvisorExplanation(
  signal: CockpitAdvisorSignal,
): AdvisorExplanation {
  return {
    headline: deterministicHeadlineFor(signal),
    body: deterministicBodyFor(signal),
    source: "deterministic",
    evidence: signal.evidence ?? [],
  };
}

/**
 * Default-safe entry point. Returns the deterministic explanation
 * unconditionally today; the LLM path remains gated and is implemented
 * outside this pure module so the builder stays free of fetch.
 */
export function buildAdvisorExplanation(
  signal: CockpitAdvisorSignal,
): AdvisorExplanation {
  // Even when the flag is on, the synchronous default returns the
  // deterministic body. An async caller can race the LLM rewrite and
  // swap `body` if it succeeds within budget.
  void isAdvisorExplanationEnabled;
  return buildDeterministicAdvisorExplanation(signal);
}
