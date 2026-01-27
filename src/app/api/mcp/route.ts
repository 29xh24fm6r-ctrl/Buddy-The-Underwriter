/**
 * Buddy MCP Server Endpoint.
 *
 * POST /api/mcp — JSON-RPC 2.0 dispatcher for buddy:// resources and tools.
 *
 * Auth: Bearer BUDDY_MCP_API_KEY
 * Bank context: params.bankId (required — MCP callers are not Clerk users)
 *
 * Never returns 500. All errors are JSON-RPC error objects.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  validateMcpAuth,
  parseJsonRpcBody,
  dispatchMcpRequest,
} from "@/lib/mcp/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Auth check
  const authHeader = req.headers.get("authorization");
  if (!validateMcpAuth(authHeader)) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Unauthorized: invalid or missing BUDDY_MCP_API_KEY" },
      },
      {
        status: 200, // Never-500 pattern — error in body
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: invalid JSON" },
      },
      {
        status: 200,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  }

  const parsed = parseJsonRpcBody(body);
  if ("error" in parsed) {
    return NextResponse.json(parsed.error, {
      status: 200,
      headers: { "cache-control": "no-store, max-age=0" },
    });
  }

  // 3. Extract bankId from params (required for tenant isolation)
  const bankId = typeof parsed.req.params?.bankId === "string"
    ? parsed.req.params.bankId
    : "";

  if (!bankId) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: parsed.req.id,
        error: { code: -32602, message: "params.bankId is required for tenant isolation" },
      },
      {
        status: 200,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  }

  // 4. Dispatch
  const response = await dispatchMcpRequest(parsed.req, bankId);

  return NextResponse.json(response, {
    status: 200,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
