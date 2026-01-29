/**
 * POST /api/pulse/forward-ledger
 *
 * Forwards un-forwarded deal_pipeline_ledger events to Pulse.
 * Concurrency-safe via claim-based locking.
 *
 * Auth: Bearer PULSE_FORWARDER_TOKEN only. No fallbacks.
 * Kill switch: PULSE_TELEMETRY_ENABLED must be "true".
 */

import { NextRequest, NextResponse } from "next/server";
import { forwardLedgerBatch } from "@/lib/pulse/forwardLedgerCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const token = process.env.PULSE_FORWARDER_TOKEN;
  if (!token) return false;
  return auth === `Bearer ${token}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const max = parseInt(url.searchParams.get("max") || "50", 10) || 50;

  const result = await forwardLedgerBatch({ max });
  return NextResponse.json(result);
}
