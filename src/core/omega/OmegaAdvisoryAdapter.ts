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
 * - Returns stale=true if unavailable
 * - All calls use sealed OmegaResult pattern
 */

import type { OmegaAdvisoryState } from "./types";

// Dynamic import to avoid hard dependency on Omega modules
// These may not exist in all environments
async function tryReadOmegaState(dealId: string): Promise<any> {
  try {
    const { readOmegaState } = await import("@/lib/omega/readOmegaState");
    return await readOmegaState(dealId);
  } catch {
    return null;
  }
}

async function tryEvaluateOmegaConfidence(dealId: string): Promise<any> {
  try {
    const { evaluateOmegaConfidence } = await import("@/lib/omega/evaluateOmegaConfidence");
    return await evaluateOmegaConfidence(dealId);
  } catch {
    return null;
  }
}

async function tryReadOmegaTraces(dealId: string): Promise<any> {
  try {
    const { readOmegaTraces } = await import("@/lib/omega/readOmegaTraces");
    return await readOmegaTraces(dealId);
  } catch {
    return null;
  }
}

/**
 * Get advisory state from Omega.
 * NEVER throws. Returns stale if Omega is unavailable.
 */
export async function getOmegaAdvisoryState(
  dealId: string,
): Promise<OmegaAdvisoryState> {
  const isEnabled = process.env.OMEGA_MCP_ENABLED === "true"
    && process.env.OMEGA_MCP_KILL_SWITCH !== "true";

  if (!isEnabled) {
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

    // Check if Omega returned meaningful data
    const hasData = state?.ok || conf?.ok;

    return {
      confidence: conf?.ok ? (conf.data?.score ?? -1) : -1,
      advisory: state?.ok ? (state.data?.recommendation ?? "") : "",
      riskEmphasis: state?.ok ? (state.data?.signals ?? []) : [],
      traceRef: tr?.ok ? (tr.data?.id ?? null) : null,
      stale: !hasData,
      staleReason: hasData ? undefined : "Omega returned no data for this deal",
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
