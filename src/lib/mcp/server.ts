/**
 * Buddy MCP Server — JSON-RPC 2.0 Dispatcher.
 *
 * Routes incoming MCP requests to the correct resource or tool handler.
 * Exposed via POST /api/mcp. Server-only.
 *
 * Protocol:
 *   Request:  { jsonrpc: "2.0", id, method: "buddy://...", params: {...} }
 *   Response: { jsonrpc: "2.0", id, result: {...} }
 *          or { jsonrpc: "2.0", id, error: { code, message } }
 *
 * Authentication:
 *   Bearer token via BUDDY_MCP_API_KEY env var.
 *   If env var not set, endpoint is disabled (returns 403).
 *
 * Resources (read-only):
 *   buddy://case/{caseId}
 *   buddy://case/{caseId}/documents
 *   buddy://case/{caseId}/signals
 *   buddy://case/{caseId}/ledger
 *   buddy://workflows/recent
 *   buddy://ledger/summary
 *   buddy://ledger/query
 *
 * Tools (side-effects):
 *   buddy://tools/replay_case
 *   buddy://tools/validate_case
 *   buddy://tools/generate_missing_docs_email
 *   buddy://tools/write_signal
 *   buddy://tools/detect_anomalies
 */
import "server-only";

import {
  handleCaseResource,
  handleCaseDocumentsResource,
  handleCaseSignalsResource,
  handleCaseLedgerResource,
  handleWorkflowsRecentResource,
  handleLedgerSummaryResource,
  handleLedgerQueryResource,
} from "./resources";

import {
  handleReplayCase,
  handleValidateCase,
  handleGenerateMissingDocsEmail,
  handleWriteSignal,
  handleDetectAnomalies,
} from "./tools";

import type { WriteSignalInput } from "./tools";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

// JSON-RPC standard error codes
const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getBuddyMcpApiKey(): string {
  return process.env.BUDDY_MCP_API_KEY ?? "";
}

export function validateMcpAuth(authHeader: string | null): boolean {
  const key = getBuddyMcpApiKey();
  if (!key) return false; // disabled if not configured
  if (!authHeader) return false;
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return token === key;
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

/** Parse a buddy:// URI into { kind, caseId?, sub? } */
function parseMethod(method: string): {
  kind: "resource" | "tool" | "unknown";
  resource?: string;
  caseId?: string;
  sub?: string;
} {
  // Resources
  const caseMatch = method.match(/^buddy:\/\/case\/([^/]+)$/);
  if (caseMatch) {
    return { kind: "resource", resource: "case", caseId: caseMatch[1] };
  }

  const caseSubMatch = method.match(/^buddy:\/\/case\/([^/]+)\/(documents|signals|ledger)$/);
  if (caseSubMatch) {
    return {
      kind: "resource",
      resource: "case_sub",
      caseId: caseSubMatch[1],
      sub: caseSubMatch[2],
    };
  }

  if (method === "buddy://workflows/recent") {
    return { kind: "resource", resource: "workflows_recent" };
  }

  if (method === "buddy://ledger/summary") {
    return { kind: "resource", resource: "ledger_summary" };
  }

  if (method === "buddy://ledger/query") {
    return { kind: "resource", resource: "ledger_query" };
  }

  // Tools
  const toolMatch = method.match(/^buddy:\/\/tools\/(\w+)$/);
  if (toolMatch) {
    return { kind: "tool", resource: toolMatch[1] };
  }

  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch a single JSON-RPC request to the correct handler.
 * Never throws — returns a well-formed JSON-RPC error on failure.
 */
export async function dispatchMcpRequest(
  req: JsonRpcRequest,
  bankId: string,
): Promise<JsonRpcResponse> {
  const id = req.id;

  try {
    if (req.jsonrpc !== "2.0" || !req.method) {
      return {
        jsonrpc: "2.0",
        id: id ?? null,
        error: { code: ERR_INVALID_REQUEST, message: "Invalid JSON-RPC 2.0 request" },
      };
    }

    const parsed = parseMethod(req.method);
    const params = req.params ?? {};

    // --- Resources ---
    if (parsed.kind === "resource") {
      if (parsed.resource === "case" && parsed.caseId) {
        const result = await handleCaseResource(parsed.caseId, bankId);
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "case_sub" && parsed.caseId && parsed.sub === "documents") {
        const result = await handleCaseDocumentsResource(parsed.caseId, bankId);
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "case_sub" && parsed.caseId && parsed.sub === "signals") {
        const result = await handleCaseSignalsResource(parsed.caseId, bankId, {
          limit: typeof params.limit === "number" ? params.limit : undefined,
          since: typeof params.since === "string" ? params.since : undefined,
        });
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "case_sub" && parsed.caseId && parsed.sub === "ledger") {
        const result = await handleCaseLedgerResource(parsed.caseId, bankId, {
          limit: typeof params.limit === "number" ? params.limit : undefined,
          since: typeof params.since === "string" ? params.since : undefined,
        });
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "ledger_summary") {
        const result = await handleLedgerSummaryResource(bankId, {
          since: typeof params.since === "string" ? params.since : undefined,
          until: typeof params.until === "string" ? params.until : undefined,
        });
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "ledger_query") {
        const result = await handleLedgerQueryResource(bankId, {
          limit: typeof params.limit === "number" ? params.limit : undefined,
          since: typeof params.since === "string" ? params.since : undefined,
          until: typeof params.until === "string" ? params.until : undefined,
          eventCategory: typeof params.eventCategory === "string" ? params.eventCategory : undefined,
          severity: typeof params.severity === "string" ? params.severity : undefined,
          eventType: typeof params.eventType === "string" ? params.eventType : undefined,
          dealId: typeof params.dealId === "string" ? params.dealId : undefined,
          source: typeof params.source === "string" ? params.source : undefined,
        });
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "workflows_recent") {
        const result = await handleWorkflowsRecentResource(bankId, {
          limit: typeof params.limit === "number" ? params.limit : undefined,
        });
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }
    }

    // --- Tools ---
    if (parsed.kind === "tool") {
      const caseId = typeof params.caseId === "string" ? params.caseId : "";

      if (parsed.resource === "replay_case") {
        if (!caseId) {
          return { jsonrpc: "2.0", id, error: { code: ERR_INVALID_PARAMS, message: "caseId required" } };
        }
        const result = await handleReplayCase(caseId, bankId);
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "validate_case") {
        if (!caseId) {
          return { jsonrpc: "2.0", id, error: { code: ERR_INVALID_PARAMS, message: "caseId required" } };
        }
        const result = await handleValidateCase(caseId, bankId);
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "generate_missing_docs_email") {
        if (!caseId) {
          return { jsonrpc: "2.0", id, error: { code: ERR_INVALID_PARAMS, message: "caseId required" } };
        }
        const result = await handleGenerateMissingDocsEmail(caseId, bankId);
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "write_signal") {
        const input: WriteSignalInput = {
          signalType: typeof params.signalType === "string" ? params.signalType : "",
          severity: typeof params.severity === "string"
            ? params.severity as WriteSignalInput["severity"]
            : undefined,
          dealId: typeof params.dealId === "string" ? params.dealId : undefined,
          payload: typeof params.payload === "object" && params.payload !== null
            ? params.payload as Record<string, unknown>
            : undefined,
          traceId: typeof params.traceId === "string" ? params.traceId : undefined,
        };
        const result = await handleWriteSignal(bankId, input);
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }

      if (parsed.resource === "detect_anomalies") {
        const result = await handleDetectAnomalies(bankId, {
          windowMinutes: typeof params.windowMinutes === "number" ? params.windowMinutes : undefined,
          errorThreshold: typeof params.errorThreshold === "number" ? params.errorThreshold : undefined,
          mismatchThreshold: typeof params.mismatchThreshold === "number" ? params.mismatchThreshold : undefined,
          staleDealHours: typeof params.staleDealHours === "number" ? params.staleDealHours : undefined,
        });
        return result.ok
          ? { jsonrpc: "2.0", id, result: result.data }
          : { jsonrpc: "2.0", id, error: { code: ERR_INTERNAL, message: result.error } };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: ERR_METHOD_NOT_FOUND, message: `Unknown method: ${req.method}` },
    };
  } catch (err: unknown) {
    return {
      jsonrpc: "2.0",
      id: id ?? null,
      error: {
        code: ERR_INTERNAL,
        message: err instanceof Error ? err.message : "Internal server error",
      },
    };
  }
}

/**
 * Parse and validate a raw JSON body into a JsonRpcRequest.
 * Returns null with an error response if invalid.
 */
export function parseJsonRpcBody(
  body: unknown,
): { req: JsonRpcRequest } | { error: JsonRpcResponse } {
  if (
    typeof body !== "object" ||
    body === null ||
    !("jsonrpc" in body) ||
    !("method" in body) ||
    !("id" in body)
  ) {
    return {
      error: {
        jsonrpc: "2.0",
        id: (body as Record<string, unknown>)?.id as string ?? null,
        error: { code: ERR_PARSE, message: "Invalid JSON-RPC request body" },
      },
    };
  }

  const b = body as Record<string, unknown>;
  return {
    req: {
      jsonrpc: String(b.jsonrpc),
      id: b.id as string | number,
      method: String(b.method),
      params: typeof b.params === "object" && b.params !== null
        ? b.params as Record<string, unknown>
        : undefined,
    },
  };
}
