import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Unit tests for Step C: MCP Exposure.
 *
 * Tests pure functions and structural contracts only — no DB, no AI, no MCP server.
 * Server-only modules are tested via source-level assertions and local replicas.
 */

const ROOT = process.cwd();

// ═══════════════════════════════════════════════════════════
// 1. Omega Transport — Structural Assertions
// ═══════════════════════════════════════════════════════════

describe("invokeOmega transport (source-level)", () => {
  const src = readFileSync(resolve(ROOT, "src/lib/omega/invokeOmega.ts"), "utf-8");

  test("uses OMEGA_MCP_URL for endpoint config", () => {
    assert.ok(src.includes("OMEGA_MCP_URL"), "Must read OMEGA_MCP_URL env var");
  });

  test("uses OMEGA_MCP_API_KEY for auth", () => {
    assert.ok(src.includes("OMEGA_MCP_API_KEY"), "Must read OMEGA_MCP_API_KEY env var");
  });

  test("sends JSON-RPC 2.0 request", () => {
    assert.ok(src.includes('"2.0"'), "Must include jsonrpc 2.0 version");
    assert.ok(src.includes("jsonrpc"), "Must reference jsonrpc field");
    assert.ok(src.includes("method:"), "Must include method field");
    assert.ok(src.includes("params:"), "Must include params field");
  });

  test("uses fetch() for HTTP transport", () => {
    assert.ok(src.includes("fetch(baseUrl"), "Must call fetch with baseUrl");
  });

  test("sends Bearer auth header", () => {
    assert.ok(src.includes("Bearer"), "Must include Bearer token header");
  });

  test("handles JSON-RPC error responses", () => {
    assert.ok(src.includes("omega_rpc_error"), "Must handle RPC errors");
    assert.ok(src.includes("omega_http_"), "Must handle HTTP errors");
    assert.ok(src.includes("omega_rpc_empty"), "Must handle empty results");
  });

  test("stub throw removed", () => {
    // The old stub had: throw new Error(`omega_not_connected: ${resource}`);
    // The new transport throws omega_not_connected only when URL not configured
    assert.ok(
      src.includes("omega_not_connected: OMEGA_MCP_URL not configured"),
      "Transport throws specific URL-not-configured error",
    );
    assert.ok(
      !src.includes("TODO: Replace with real MCP client"),
      "TODO stub comment removed",
    );
  });

  test("preserves kill switch + enabled + timeout", () => {
    assert.ok(src.includes("isOmegaKilled"), "Kill switch preserved");
    assert.ok(src.includes("isOmegaEnabled"), "Enabled check preserved");
    assert.ok(src.includes("safeWithTimeout"), "Timeout wrapper preserved");
  });

  test("preserves sealed result pattern", () => {
    assert.ok(src.includes("ok: true"), "Returns ok: true on success");
    assert.ok(src.includes("ok: false"), "Returns ok: false on failure");
  });

  test("has monotonic request ID generation", () => {
    assert.ok(src.includes("_jsonRpcSeq"), "Monotonic sequence counter exists");
    assert.ok(src.includes("requestId"), "Request ID is generated");
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Buddy MCP Server — Structural Assertions
// ═══════════════════════════════════════════════════════════

describe("Buddy MCP server (source-level)", () => {
  const src = readFileSync(resolve(ROOT, "src/lib/mcp/server.ts"), "utf-8");

  test("exports dispatchMcpRequest", () => {
    assert.ok(src.includes("export async function dispatchMcpRequest"));
  });

  test("exports validateMcpAuth", () => {
    assert.ok(src.includes("export function validateMcpAuth"));
  });

  test("exports parseJsonRpcBody", () => {
    assert.ok(src.includes("export function parseJsonRpcBody"));
  });

  test("uses BUDDY_MCP_API_KEY for auth", () => {
    assert.ok(src.includes("BUDDY_MCP_API_KEY"));
  });

  test("handles JSON-RPC standard error codes", () => {
    assert.ok(src.includes("-32700"), "Parse error code");
    assert.ok(src.includes("-32600"), "Invalid request code");
    assert.ok(src.includes("-32601"), "Method not found code");
    assert.ok(src.includes("-32602"), "Invalid params code");
    assert.ok(src.includes("-32603"), "Internal error code");
  });

  test("routes buddy://case/ resources", () => {
    assert.ok(src.includes("buddy://case/"));
    assert.ok(src.includes("handleCaseResource"));
    assert.ok(src.includes("handleCaseDocumentsResource"));
    assert.ok(src.includes("handleCaseSignalsResource"));
  });

  test("routes buddy://workflows/recent", () => {
    assert.ok(src.includes("buddy://workflows/recent"));
    assert.ok(src.includes("handleWorkflowsRecentResource"));
  });

  test("routes buddy://tools/*", () => {
    assert.ok(src.includes("buddy://tools/"));
    assert.ok(src.includes("handleReplayCase"));
    assert.ok(src.includes("handleValidateCase"));
    assert.ok(src.includes("handleGenerateMissingDocsEmail"));
  });

  test("imports from resources and tools modules", () => {
    assert.ok(src.includes("./resources"));
    assert.ok(src.includes("./tools"));
  });
});

// ═══════════════════════════════════════════════════════════
// 3. Buddy MCP API Route — Structural Assertions
// ═══════════════════════════════════════════════════════════

describe("Buddy MCP API route (source-level)", () => {
  const src = readFileSync(resolve(ROOT, "src/app/api/mcp/route.ts"), "utf-8");

  test("exports POST handler", () => {
    assert.ok(src.includes("export async function POST"));
  });

  test("is force-dynamic", () => {
    assert.ok(src.includes('force-dynamic'));
  });

  test("validates auth via validateMcpAuth", () => {
    assert.ok(src.includes("validateMcpAuth"));
  });

  test("dispatches via dispatchMcpRequest", () => {
    assert.ok(src.includes("dispatchMcpRequest"));
  });

  test("extracts bankId for tenant isolation", () => {
    assert.ok(src.includes("bankId"));
    assert.ok(src.includes("params.bankId"));
  });

  test("imports from @/lib/mcp/server", () => {
    assert.ok(src.includes("@/lib/mcp/server"));
  });

  test("never returns 500 — all responses use status 200", () => {
    // All NextResponse.json calls should use status: 200
    assert.ok(src.includes("status: 200"));
    assert.ok(!src.includes("status: 500"));
    assert.ok(!src.includes("status: 401"));
    assert.ok(!src.includes("status: 403"));
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Resource Handlers — Structural Assertions
// ═══════════════════════════════════════════════════════════

describe("Buddy MCP resource handlers (source-level)", () => {
  const src = readFileSync(resolve(ROOT, "src/lib/mcp/resources.ts"), "utf-8");

  test("exports all 4 resource handlers", () => {
    const handlers = [
      "handleCaseResource",
      "handleCaseDocumentsResource",
      "handleCaseSignalsResource",
      "handleWorkflowsRecentResource",
    ];
    for (const h of handlers) {
      assert.ok(
        src.includes(`export async function ${h}`),
        `${h} must be exported`,
      );
    }
  });

  test("uses supabaseAdmin for database queries", () => {
    assert.ok(src.includes("supabaseAdmin"));
  });

  test("applies EIN masking via maskEin", () => {
    assert.ok(src.includes("maskEin"));
  });

  test("filters by bank_id for tenant isolation", () => {
    assert.ok(src.includes("bank_id"));
  });

  test("queries deal_documents table", () => {
    assert.ok(src.includes("deal_documents"));
  });

  test("queries buddy_signal_ledger table", () => {
    assert.ok(src.includes("buddy_signal_ledger"));
  });

  test("queries deals table", () => {
    assert.ok(src.includes("deals"));
  });

  test("returns McpResourceResult shape", () => {
    assert.ok(src.includes("McpResourceResult"));
    assert.ok(src.includes("ok: true"));
    assert.ok(src.includes("ok: false"));
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Tool Handlers — Structural Assertions
// ═══════════════════════════════════════════════════════════

describe("Buddy MCP tool handlers (source-level)", () => {
  const src = readFileSync(resolve(ROOT, "src/lib/mcp/tools.ts"), "utf-8");

  test("exports all 3 tool handlers", () => {
    const tools = [
      "handleReplayCase",
      "handleValidateCase",
      "handleGenerateMissingDocsEmail",
    ];
    for (const t of tools) {
      assert.ok(
        src.includes(`export async function ${t}`),
        `${t} must be exported`,
      );
    }
  });

  test("replay tool uses mirrorEventToOmega", () => {
    assert.ok(src.includes("mirrorEventToOmega"));
  });

  test("validate tool checks multiple validation conditions", () => {
    assert.ok(src.includes("deal_exists"));
    assert.ok(src.includes("borrower_linked"));
    assert.ok(src.includes("has_documents"));
    assert.ok(src.includes("has_signals"));
    assert.ok(src.includes("lifecycle_valid"));
  });

  test("email tool generates proper draft", () => {
    assert.ok(src.includes("emailDraft"));
    assert.ok(src.includes("missingDocuments"));
    assert.ok(src.includes("Subject:"));
  });

  test("tools filter by bank_id", () => {
    assert.ok(src.includes("bank_id"));
  });

  test("returns McpToolResult shape", () => {
    assert.ok(src.includes("McpToolResult"));
  });
});

// ═══════════════════════════════════════════════════════════
// 6. JSON-RPC Dispatcher — Local Replica Tests
// ═══════════════════════════════════════════════════════════

describe("parseMethod (local replica)", () => {
  // Replica of the parseMethod function from server.ts
  function parseMethod(method: string): {
    kind: "resource" | "tool" | "unknown";
    resource?: string;
    caseId?: string;
    sub?: string;
  } {
    const caseMatch = method.match(/^buddy:\/\/case\/([^/]+)$/);
    if (caseMatch) {
      return { kind: "resource", resource: "case", caseId: caseMatch[1] };
    }

    const caseSubMatch = method.match(/^buddy:\/\/case\/([^/]+)\/(documents|signals)$/);
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

    const toolMatch = method.match(/^buddy:\/\/tools\/(\w+)$/);
    if (toolMatch) {
      return { kind: "tool", resource: toolMatch[1] };
    }

    return { kind: "unknown" };
  }

  test("parses buddy://case/{id}", () => {
    const r = parseMethod("buddy://case/abc-123");
    assert.equal(r.kind, "resource");
    assert.equal(r.resource, "case");
    assert.equal(r.caseId, "abc-123");
  });

  test("parses buddy://case/{id}/documents", () => {
    const r = parseMethod("buddy://case/abc-123/documents");
    assert.equal(r.kind, "resource");
    assert.equal(r.resource, "case_sub");
    assert.equal(r.caseId, "abc-123");
    assert.equal(r.sub, "documents");
  });

  test("parses buddy://case/{id}/signals", () => {
    const r = parseMethod("buddy://case/abc-123/signals");
    assert.equal(r.kind, "resource");
    assert.equal(r.resource, "case_sub");
    assert.equal(r.caseId, "abc-123");
    assert.equal(r.sub, "signals");
  });

  test("parses buddy://workflows/recent", () => {
    const r = parseMethod("buddy://workflows/recent");
    assert.equal(r.kind, "resource");
    assert.equal(r.resource, "workflows_recent");
  });

  test("parses buddy://tools/replay_case", () => {
    const r = parseMethod("buddy://tools/replay_case");
    assert.equal(r.kind, "tool");
    assert.equal(r.resource, "replay_case");
  });

  test("parses buddy://tools/validate_case", () => {
    const r = parseMethod("buddy://tools/validate_case");
    assert.equal(r.kind, "tool");
    assert.equal(r.resource, "validate_case");
  });

  test("parses buddy://tools/generate_missing_docs_email", () => {
    const r = parseMethod("buddy://tools/generate_missing_docs_email");
    assert.equal(r.kind, "tool");
    assert.equal(r.resource, "generate_missing_docs_email");
  });

  test("returns unknown for invalid methods", () => {
    assert.equal(parseMethod("").kind, "unknown");
    assert.equal(parseMethod("omega://events/write").kind, "unknown");
    assert.equal(parseMethod("buddy://unknown/path").kind, "unknown");
  });
});

// ═══════════════════════════════════════════════════════════
// 7. Auth Validation — Local Replica Tests
// ═══════════════════════════════════════════════════════════

describe("validateMcpAuth (local replica)", () => {
  function validateMcpAuth(apiKey: string, authHeader: string | null): boolean {
    if (!apiKey) return false;
    if (!authHeader) return false;
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    return token === apiKey;
  }

  test("rejects when API key not configured", () => {
    assert.equal(validateMcpAuth("", "Bearer some-token"), false);
  });

  test("rejects when no auth header", () => {
    assert.equal(validateMcpAuth("secret", null), false);
  });

  test("rejects invalid token", () => {
    assert.equal(validateMcpAuth("secret", "Bearer wrong"), false);
  });

  test("accepts valid Bearer token", () => {
    assert.equal(validateMcpAuth("secret", "Bearer secret"), true);
  });

  test("rejects non-Bearer format", () => {
    assert.equal(validateMcpAuth("secret", "Basic secret"), false);
  });
});

// ═══════════════════════════════════════════════════════════
// 8. JSON-RPC Body Parser — Local Replica Tests
// ═══════════════════════════════════════════════════════════

describe("parseJsonRpcBody (local replica)", () => {
  function parseJsonRpcBody(
    body: unknown,
  ): { req: { jsonrpc: string; id: string | number; method: string; params?: Record<string, unknown> } } | { error: unknown } {
    if (
      typeof body !== "object" ||
      body === null ||
      !("jsonrpc" in body) ||
      !("method" in body) ||
      !("id" in body)
    ) {
      return { error: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC request body" } } };
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

  test("parses valid JSON-RPC request", () => {
    const result = parseJsonRpcBody({
      jsonrpc: "2.0",
      id: 1,
      method: "buddy://case/abc",
      params: { bankId: "b-1" },
    });
    assert.ok("req" in result);
    if ("req" in result) {
      assert.equal(result.req.method, "buddy://case/abc");
      assert.deepEqual(result.req.params, { bankId: "b-1" });
    }
  });

  test("rejects missing fields", () => {
    const result = parseJsonRpcBody({ foo: "bar" });
    assert.ok("error" in result);
  });

  test("rejects null body", () => {
    const result = parseJsonRpcBody(null);
    assert.ok("error" in result);
  });

  test("handles missing params gracefully", () => {
    const result = parseJsonRpcBody({
      jsonrpc: "2.0",
      id: "req-1",
      method: "buddy://workflows/recent",
    });
    assert.ok("req" in result);
    if ("req" in result) {
      assert.equal(result.req.params, undefined);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 9. Cross-module Wiring Contract
// ═══════════════════════════════════════════════════════════

describe("cross-module wiring", () => {
  test("server.ts imports resources and tools", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/mcp/server.ts"), "utf-8");
    assert.ok(src.includes("./resources"), "Imports resources");
    assert.ok(src.includes("./tools"), "Imports tools");
  });

  test("API route imports from @/lib/mcp/server", () => {
    const src = readFileSync(resolve(ROOT, "src/app/api/mcp/route.ts"), "utf-8");
    assert.ok(src.includes("@/lib/mcp/server"));
  });

  test("resources.ts uses server-only guard", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/mcp/resources.ts"), "utf-8");
    assert.ok(src.includes('import "server-only"'));
  });

  test("tools.ts uses server-only guard", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/mcp/tools.ts"), "utf-8");
    assert.ok(src.includes('import "server-only"'));
  });

  test("server.ts uses server-only guard", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/mcp/server.ts"), "utf-8");
    assert.ok(src.includes('import "server-only"'));
  });

  test("all new files are TypeScript", () => {
    // Verify all new MCP files exist
    const files = [
      "src/lib/mcp/resources.ts",
      "src/lib/mcp/tools.ts",
      "src/lib/mcp/server.ts",
      "src/app/api/mcp/route.ts",
    ];
    for (const f of files) {
      try {
        readFileSync(resolve(ROOT, f), "utf-8");
      } catch {
        assert.fail(`File ${f} does not exist`);
      }
    }
  });
});
