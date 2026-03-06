/**
 * POST /api/pulse/ingest
 *
 * Receives forwarded deal_pipeline_ledger events from forwardLedgerCore.ts
 * and writes them to buddy_ledger_events for Pulse observer visibility.
 *
 * Auth: HMAC-SHA256 signature on request body, verified against
 *       PULSE_BUDDY_INGEST_SECRET. Header: x-pulse-signature
 *
 * This is the target for PULSE_BUDDY_INGEST_URL env var.
 * Set PULSE_BUDDY_INGEST_URL = https://[your-vercel-domain]/api/pulse/ingest
 * Set PULSE_BUDDY_INGEST_SECRET = <random secret, same value used by forwarder>
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  // Constant-time comparison to prevent timing attacks
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

  const sb = supabaseAdmin();

  const { error } = await sb.from("buddy_ledger_events").insert({
    source: event.source ?? "buddy",
    env: event.env ?? "unknown",
    deal_id: event.deal_id,
    bank_id: event.bank_id ?? null,
    event_key: event.event_key,
    event_created_at: event.created_at,
    trace_id: event.trace_id,
    payload: event.payload ?? {},
    ingested_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[pulse/ingest] insert failed", error.message);
    return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
