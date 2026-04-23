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
import {
  translateResourceToToolCall,
  isReadResource,
  type ToolCall,
} from "./translator";

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
 *
 * OMEGA_MCP_URL: base URL of the deployed Pulse MCP (e.g. https://pulse-mcp-*.run.app)
 * OMEGA_MCP_KEY: x-pulse-mcp-key value (preferred; Sensitive in Vercel)
 * OMEGA_MCP_API_KEY: deprecated alias; falls back only if OMEGA_MCP_KEY is unset
 * OMEGA_TARGET_USER_ID: optional viewer UUID injected as target_user_id in tool args
 */
function getOmegaMcpUrl(): string {
  return process.env.OMEGA_MCP_URL ?? "";
}

function getOmegaMcpApiKey(): string | undefined {
  const newKey = process.env.OMEGA_MCP_KEY;
  if (newKey) return newKey;
  const fallback = process.env.OMEGA_MCP_API_KEY;
  if (fallback) {
    console.warn(
      "[omega] using deprecated OMEGA_MCP_API_KEY env var — rename to OMEGA_MCP_KEY",
    );
    return fallback;
  }
  return undefined;
}

function getOmegaTargetUserId(): string | undefined {
  return process.env.OMEGA_TARGET_USER_ID || undefined;
}

/** Monotonic request ID for JSON-RPC correlation within this process. */
let _jsonRpcSeq = 0;

/**
 * Actual MCP call. This is the ONLY place that touches the wire.
 *
 * Translates the Buddy `omega://` resource URI into a Pulse MCP `tools/call`
 * JSON-RPC request, sends it with `x-pulse-mcp-key` auth, and unwraps the
 * MCP response envelope. Throws on any transport, translation, or RPC error
 * — the caller (invokeOmega) catches via safeWithTimeout and converts to
 * { ok: false }.
 */
async function mcpCall<T>(
  resource: string,
  payload: unknown,
): Promise<T> {
  const baseUrl = getOmegaMcpUrl();
  if (!baseUrl) {
    throw new Error("omega_not_connected: OMEGA_MCP_URL not configured");
  }

  const toolCall: ToolCall | null = translateResourceToToolCall(
    resource,
    payload,
    getOmegaTargetUserId(),
  );
  if (!toolCall) {
    const err = isReadResource(resource)
      ? "pulse_advisory_tools_not_yet_available"
      : `omega_unmapped_resource: ${resource}`;
    throw new Error(err);
  }

  const apiKey = getOmegaMcpApiKey();
  const requestId = `buddy-${++_jsonRpcSeq}-${Date.now().toString(36)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
  if (apiKey) {
    headers["x-pulse-mcp-key"] = apiKey;
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name: toolCall.tool,
      arguments: toolCall.arguments,
    },
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
    result?: {
      structuredContent?: unknown;
      content?: Array<unknown>;
    } & Record<string, unknown>;
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

  const unwrapped =
    rpc.result.structuredContent ??
    rpc.result.content?.[0] ??
    rpc.result;
  if (unwrapped === undefined || unwrapped === null) {
    throw new Error("omega_rpc_empty: no content in response");
  }

  return unwrapped as T;
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
