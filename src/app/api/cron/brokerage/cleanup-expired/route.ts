import "server-only";

/**
 * POST /api/cron/brokerage/cleanup-expired
 *
 * Nightly sweep of expired borrower session tokens + rate-limit counters.
 * Triggered by Vercel cron; authenticated via Bearer token from CRON_SECRET.
 *
 * See revisions-round-4.md S1-4.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const tokens = await sb
    .from("borrower_session_tokens")
    .delete()
    .lt("expires_at", now);

  const counters = await sb
    .from("rate_limit_counters")
    .delete()
    .lt("expires_at", now);

  return NextResponse.json({
    ok: true,
    tokens_deleted: tokens.count ?? 0,
    counters_deleted: counters.count ?? 0,
  });
}
