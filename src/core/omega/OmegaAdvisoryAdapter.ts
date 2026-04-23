import "server-only";

/**
 * OmegaAdvisoryAdapter — Phase 65A
 *
 * Read-only advisory layer from Pulse Omega Prime.
 * Omega annotates. Buddy decides.
 *
 * RULES:
 * - NEVER throws
 * - NEVER mutates deal state
 * - NEVER reads/writes DB directly (guard-enforced)
 * - Returns stale=true if unavailable
 * - All calls use sealed OmegaResult pattern
 *
 * The ai_risk_runs fallback lives in the state API route, not here.
 * This adapter only talks to Pulse state view or returns stale.
 */

import type { OmegaAdvisoryState } from "./types";

// ---------------------------------------------------------------------------
// Pulse state view helpers (dynamic imports — may not exist in all envs)
// ---------------------------------------------------------------------------

async function tryReadOmegaState(dealId: string): Promise<any> {
  try {
    const { readOmegaState } = await import("@/lib/omega/readOmegaState");
    return await readOmegaState({ stateType: "underwriting_case", id: dealId, correlationId: dealId });
  } catch {
    return null;
  }
}

async function tryEvaluateOmegaConfidence(dealId: string): Promise<any> {
  try {
    const { evaluateOmegaConfidence } = await import("@/lib/omega/evaluateOmegaConfidence");
    return await evaluateOmegaConfidence({ underwritingCaseId: dealId, correlationId: dealId });
  } catch {
    return null;
  }
}

async function tryReadOmegaTraces(dealId: string): Promise<any> {
  try {
    const { readOmegaTraces } = await import("@/lib/omega/readOmegaTraces");
    return await readOmegaTraces({ sessionId: dealId, correlationId: dealId });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ai_risk_runs synthesis — pure function, no DB access
// ---------------------------------------------------------------------------

export interface AiRiskFactor {
  label: string;
  direction: "positive" | "negative" | "neutral";
  rationale: string;
  confidence?: number;
}

export interface AiRiskResult {
  grade?: string;
  factors?: AiRiskFactor[];
  baseRateBps?: number;
  riskPremiumBps?: number;
}

/**
 * Synthesize OmegaAdvisoryState from a local ai_risk_runs result.
 * Pure function — caller is responsible for DB read.
 */
export function synthesizeAdvisoryFromRisk(risk: AiRiskResult): OmegaAdvisoryState {
  const grade = risk.grade ?? "Ungraded";
  const factors = risk.factors ?? [];

  const negatives = factors.filter((f) => f.direction === "negative");
  const positives = factors.filter((f) => f.direction === "positive");

  const parts: string[] = [`Risk grade: ${grade}.`];
  if (positives.length > 0) {
    parts.push(`Strengths: ${positives.map((f) => f.label).join(", ")}.`);
  }
  if (negatives.length > 0) {
    parts.push(`Watch: ${negatives.map((f) => f.label).join(", ")}.`);
  }

  const riskEmphasis = negatives.map((f) => f.label);

  const confidences = factors.map((f) => f.confidence ?? 0.5);
  const avgConf = confidences.length > 0
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100)
    : -1;

  return {
    confidence: avgConf,
    advisory: parts.join(" "),
    riskEmphasis,
    traceRef: null,
    stale: false,
    staleReason: undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get advisory state from Omega Pulse.
 * NEVER throws. Returns stale if Pulse is unavailable.
 * The state API route handles ai_risk_runs fallback separately.
 */
export async function getOmegaAdvisoryState(
  dealId: string,
): Promise<OmegaAdvisoryState> {
  const pulseEnabled = process.env.OMEGA_MCP_ENABLED === "1"
    && process.env.OMEGA_MCP_KILL_SWITCH !== "1";

  if (!pulseEnabled) {
    return {
      confidence: -1,
      advisory: "",
      riskEmphasis: [],
      traceRef: null,
      stale: true,
      staleReason: "Omega MCP not enabled",
    };
  }

  try {
    const [omegaState, confidence, trace] = await Promise.allSettled([
      tryReadOmegaState(dealId),
      tryEvaluateOmegaConfidence(dealId),
      tryReadOmegaTraces(dealId),
    ]);

    const state = omegaState.status === "fulfilled" ? omegaState.value : null;
    const conf = confidence.status === "fulfilled" ? confidence.value : null;
    const tr = trace.status === "fulfilled" ? trace.value : null;

    const hasData = state?.ok || conf?.ok;

    // Distinguish the kill-switched read-path signal from generic "no data".
    // If any sub-call carries pulse_advisory_tools_not_yet_available, Pulse
    // simply doesn't expose deal-scoped advisory tools yet (PULSE-SIDE-SPEC).
    const subResults = [state, conf, tr];
    const anyKillSwitched = subResults.some(
      (r) =>
        r &&
        r.ok === false &&
        r.error === "pulse_advisory_tools_not_yet_available",
    );

    let staleReason: string | undefined;
    if (!hasData) {
      staleReason = anyKillSwitched
        ? "Deal-scoped advisory tools not yet available in Pulse"
        : "Omega returned no data for this deal";
    }

    return {
      confidence: conf?.ok ? (conf.data?.score ?? -1) : -1,
      advisory: state?.ok ? (state.data?.recommendation ?? "") : "",
      riskEmphasis: state?.ok ? (state.data?.signals ?? []) : [],
      traceRef: tr?.ok ? (tr.data?.id ?? null) : null,
      stale: !hasData,
      staleReason,
    };
  } catch (err) {
    console.error("[OmegaAdvisoryAdapter] error:", err);
    return {
      confidence: -1,
      advisory: "",
      riskEmphasis: [],
      traceRef: null,
      stale: true,
      staleReason: `Omega error: ${String(err)}`,
    };
  }
}
