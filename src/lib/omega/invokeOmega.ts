/**
 * Omega MCP Invocation Primitive — Single Chokepoint.
 *
 * Every Omega call flows through this function. It:
 * - Checks kill switch + enabled flag
 * - Enforces timeout
 * - Never throws
 * - Ledgers every invocation outcome
 * - Emits api.degraded on failure
 *
 * Server-only.
 */
import "server-only";

import { safeWithTimeout } from "@/lib/api/envelope";

// ---------------------------------------------------------------------------
// Environment config (read once per cold start, testable via overrides)
// ---------------------------------------------------------------------------

function isOmegaEnabled(): boolean {
  return process.env.OMEGA_MCP_ENABLED === "1";
}

function isOmegaKilled(): boolean {
  return process.env.OMEGA_MCP_KILL_SWITCH === "1";
}

function getOmegaTimeout(): number {
  const ms = Number(process.env.OMEGA_MCP_TIMEOUT_MS);
  return ms > 0 ? ms : 5000;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OmegaResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface InvokeOmegaOpts {
  resource: string; // e.g. omega://events/write
  correlationId: string;
  payload?: unknown; // already redacted
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Ledger helper (fire-and-forget, never blocks, never throws)
// ---------------------------------------------------------------------------

async function ledgerOmegaSignal(
  type: "omega.invoked" | "omega.succeeded" | "omega.failed" | "omega.timed_out" | "omega.killed",
  correlationId: string,
  resource: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const { writeBuddySignal } = await import("@/buddy/server/writeBuddySignal");
    await writeBuddySignal({
      type,
      ts: Date.now(),
      source: "omega/invokeOmega",
      payload: { correlationId, resource, ...extra },
    });
  } catch {
    // Never throw from ledger writes
  }
}

async function emitDegraded(
  correlationId: string,
  resource: string,
  message: string,
): Promise<void> {
  try {
    const { trackDegradedResponse } = await import("@/lib/api/degradedTracker");
    await trackDegradedResponse({
      endpoint: `omega:${resource}`,
      code: "omega_unavailable",
      message,
      dealId: "n/a",
      correlationId,
    });
  } catch {
    // Never throw
  }
}

// ---------------------------------------------------------------------------
// MCP transport — HTTP JSON-RPC to Omega Prime
// ---------------------------------------------------------------------------

/**
 * Read Omega MCP endpoint config.
 * OMEGA_MCP_URL: base URL of Omega Prime MCP server (e.g. https://omega.example.com/mcp)
 * OMEGA_MCP_API_KEY: optional Bearer token for authenticated endpoints
 */
function getOmegaMcpUrl(): string {
  return process.env.OMEGA_MCP_URL ?? "";
}

function getOmegaMcpApiKey(): string | undefined {
  return process.env.OMEGA_MCP_API_KEY || undefined;
}

/** Monotonic request ID for JSON-RPC correlation within this process. */
let _jsonRpcSeq = 0;

/**
 * Actual MCP call. This is the ONLY place that touches the wire.
 *
 * Sends a JSON-RPC 2.0 POST to the configured OMEGA_MCP_URL.
 * The `resource` string (e.g. "omega://events/write") becomes the JSON-RPC
 * `method` field. The `payload` becomes `params`.
 *
 * Throws on any transport or protocol error — the caller (invokeOmega)
 * catches via safeWithTimeout and converts to { ok: false }.
 */
async function mcpCall<T>(
  resource: string,
  payload: unknown,
): Promise<T> {
  const baseUrl = getOmegaMcpUrl();
  if (!baseUrl) {
    throw new Error("omega_not_connected: OMEGA_MCP_URL not configured");
  }

  const apiKey = getOmegaMcpApiKey();
  const requestId = `buddy-${++_jsonRpcSeq}-${Date.now().toString(36)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method: resource,
    params: payload ?? {},
  });

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(
      `omega_http_${response.status}: ${response.statusText || "request failed"}`,
    );
  }

  const json: unknown = await response.json();
  const rpc = json as {
    jsonrpc?: string;
    id?: string;
    result?: T;
    error?: { code?: number; message?: string };
  };

  if (rpc.error) {
    throw new Error(
      `omega_rpc_error: ${rpc.error.message ?? `code ${rpc.error.code}`}`,
    );
  }

  if (rpc.result === undefined) {
    throw new Error("omega_rpc_empty: no result in response");
  }

  return rpc.result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Invoke an Omega MCP resource.
 *
 * - If disabled or killed → returns { ok: false, error: "disabled"|"killed" }
 * - If timeout → returns { ok: false, error: "timeout:..." }
 * - If error → returns { ok: false, error: "..." }
 * - NEVER throws
 * - Ledgers every outcome
 */
export async function invokeOmega<T>(opts: InvokeOmegaOpts): Promise<OmegaResult<T>> {
  const { resource, correlationId, payload, timeoutMs } = opts;
  const timeout = timeoutMs ?? getOmegaTimeout();

  // Kill switch
  if (isOmegaKilled()) {
    ledgerOmegaSignal("omega.killed", correlationId, resource).catch(() => {});
    return { ok: false, error: "killed" };
  }

  // Enabled check
  if (!isOmegaEnabled()) {
    return { ok: false, error: "disabled" };
  }

  // Ledger invocation
  ledgerOmegaSignal("omega.invoked", correlationId, resource).catch(() => {});

  // Execute with timeout
  const result = await safeWithTimeout<T>(
    mcpCall<T>(resource, payload),
    timeout,
    `omega:${resource}`,
    correlationId,
  );

  if (result.ok) {
    ledgerOmegaSignal("omega.succeeded", correlationId, resource).catch(() => {});
    return { ok: true, data: result.data };
  }

  // Determine failure type
  const isTimeout = result.error.startsWith("timeout:");
  const signalType = isTimeout ? "omega.timed_out" as const : "omega.failed" as const;

  ledgerOmegaSignal(signalType, correlationId, resource, { error: result.error }).catch(() => {});
  emitDegraded(correlationId, resource, result.error).catch(() => {});

  return { ok: false, error: result.error };
}
