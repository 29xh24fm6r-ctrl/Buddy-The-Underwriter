import "server-only";

/**
 * GET|POST /api/cron/brokerage/cleanup-expired
 *
 * Nightly sweep of expired borrower session tokens + rate-limit counters.
 * Vercel cron invokes GET; POST is retained for authenticated manual recovery.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { secretEquals } from "@/lib/brokerage/secretEquals";
import { recordAiEvent } from "@/lib/ai/audit";

export const runtime = "nodejs";

async function runCleanup(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secretEquals(provided, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const ranAt = new Date().toISOString();
  const [tokens, counters, verifications] = await Promise.all([
    sb.from("borrower_session_tokens").delete({ count: "exact" }).lt("expires_at", ranAt),
    sb.from("rate_limit_counters").delete({ count: "exact" }).lt("expires_at", ranAt),
    sb.from("borrower_email_verifications").delete({ count: "exact" }).lt("expires_at", ranAt),
  ]);
  const failures = [
    tokens.error ? { table: "borrower_session_tokens", error: tokens.error.message } : null,
    counters.error ? { table: "rate_limit_counters", error: counters.error.message } : null,
    verifications.error
      ? { table: "borrower_email_verifications", error: verifications.error.message }
      : null,
  ].filter(Boolean);
  const output = {
    ran_at: ranAt,
    tokens_deleted: tokens.count ?? 0,
    counters_deleted: counters.count ?? 0,
    verifications_deleted: verifications.count ?? 0,
    failures,
  };

  try {
    await recordAiEvent({
      scope: "brokerage_session_cleanup",
      action: failures.length === 0 ? "completed" : "failed",
      output_json: output,
      confidence: 1,
      requires_human_review: failures.length > 0,
    });
  } catch (e) {
    console.error("[brokerage cleanup] evidence persistence failed", e);
    return NextResponse.json(
      { ok: false, error: "cleanup evidence persistence failed", ...output },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: failures.length === 0, ...output },
    { status: failures.length === 0 ? 200 : 500 },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return runCleanup(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return runCleanup(req);
}
