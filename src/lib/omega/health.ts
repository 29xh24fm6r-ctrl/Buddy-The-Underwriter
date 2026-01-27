/**
 * Omega Health Check.
 *
 * Pings Omega to determine availability, records latency.
 * Used by admin surfaces and gate probes.
 *
 * Server-only.
 */
import "server-only";

import { invokeOmega } from "./invokeOmega";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OmegaHealthStatus {
  available: boolean;
  enabled: boolean;
  killed: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check Omega health by pinging a safe read-only resource.
 *
 * Returns availability, config state, and latency.
 */
export async function checkOmegaHealth(
  correlationId: string,
): Promise<OmegaHealthStatus> {
  const enabled = process.env.OMEGA_MCP_ENABLED === "1";
  const killed = process.env.OMEGA_MCP_KILL_SWITCH === "1";
  const checkedAt = new Date().toISOString();

  if (!enabled || killed) {
    return {
      available: false,
      enabled,
      killed,
      latencyMs: null,
      error: killed ? "kill_switch_active" : "disabled",
      checkedAt,
    };
  }

  const start = performance.now();

  const result = await invokeOmega<{ ok: boolean }>({
    resource: "omega://health/ping",
    correlationId,
    timeoutMs: 3000, // Shorter timeout for health checks
  });

  const latencyMs = Math.round(performance.now() - start);

  if (result.ok) {
    return {
      available: true,
      enabled,
      killed,
      latencyMs,
      error: null,
      checkedAt,
    };
  }

  return {
    available: false,
    enabled,
    killed,
    latencyMs,
    error: result.error,
    checkedAt,
  };
}
