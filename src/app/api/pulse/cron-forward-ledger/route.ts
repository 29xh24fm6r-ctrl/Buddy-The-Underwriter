/**
 * POST /api/pulse/cron-forward-ledger
 *
 * Vercel Cron entry point for the Pulse ledger forwarder.
 * No secrets in the URL — auth via CRON_SECRET Bearer token
 * (set automatically by Vercel for cron jobs).
 *
 * Calls the shared forwardLedgerBatch core directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { forwardLedgerBatch } from "@/lib/pulse/forwardLedgerCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isCronAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return auth === `Bearer ${cronSecret}`;
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const max = parseInt(url.searchParams.get("max") || "50", 10) || 50;

  const result = await forwardLedgerBatch({ max });
  return NextResponse.json(result);
}

// Vercel Cron sends GET — delegate to POST (POST checks cron auth)
export async function GET(req: NextRequest) {
  return POST(req);
}
