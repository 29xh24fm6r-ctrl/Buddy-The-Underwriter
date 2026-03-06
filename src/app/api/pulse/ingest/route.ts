/**
 * POST /api/pulse/ingest
 *
 * Receives forwarded deal_pipeline_ledger events from forwardLedgerCore.ts
 * and writes them to Pulse via the Pulse MCP server's buddy_ledger_write tool.
 *
 * Auth: HMAC-SHA256 signature on request body, verified against
 *       PULSE_BUDDY_INGEST_SECRET. Header: x-pulse-signature
 *
 * Env vars required:
 *   PULSE_BUDDY_INGEST_SECRET  — shared HMAC secret with forwardLedgerCore
 *   PULSE_MCP_URL              — Pulse MCP server base URL
 *                                e.g. https://pulse-mcp-651478110010.us-central1.run.app
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.PULSE_BUDDY_INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "ingest_not_configured" }, { status: 503 });
  }

  const signature = req.headers.get("x-pulse-signature") ?? "";
  const rawBody = await req.text();

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ ok: false, error: "invalid_signature" }, { status: 401 });
  }

  let event: {
    source: string;
    env: string;
    deal_id: string;
    bank_id: string | null;
    event_key: string;
    created_at: string;
    trace_id: string;
    payload: unknown;
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // Forward to Pulse MCP server using JSON-RPC 2.0 (tools/call)
  const pulseMcpUrl = process.env.PULSE_MCP_URL;
  if (!pulseMcpUrl) {
    console.error("[pulse/ingest] PULSE_MCP_URL not set");
    return NextResponse.json({ ok: false, error: "pulse_mcp_not_configured" }, { status: 503 });
  }

  const mcpPayload = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "tools/call",
    params: {
      name: "buddy_ledger_write",
      arguments: {
        event_type: event.event_key,
        status: "success",
        deal_id: event.deal_id ?? undefined,
        payload: {
          source: event.source,
          env: event.env,
          bank_id: event.bank_id,
          trace_id: event.trace_id,
          event_created_at: event.created_at,
          ...(typeof event.payload === "object" && event.payload !== null
            ? (event.payload as Record<string, unknown>)
            : { raw: event.payload }),
        },
      },
    },
  };

  try {
    const res = await fetch(`${pulseMcpUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mcpPayload),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[pulse/ingest] Pulse MCP write failed", res.status, text);
      return NextResponse.json({ ok: false, error: `pulse_write_failed:${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[pulse/ingest] Pulse MCP request error", err?.message);
    return NextResponse.json({ ok: false, error: "pulse_unreachable" }, { status: 502 });
  }
}
