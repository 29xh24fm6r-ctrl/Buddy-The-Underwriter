import "server-only";

/**
 * Phase 65F — Borrower Campaign Reminder Processor Route
 *
 * POST /api/admin/borrower-reminders/process
 *
 * Processes due borrower campaign reminders.
 * Auth: Bearer token (CRON_SECRET) for cron/admin use.
 */

import { NextRequest, NextResponse } from "next/server";
import { processBorrowerReminders } from "@/lib/borrower-reminders/processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth via CRON_SECRET bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processBorrowerReminders();

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    console.error("[POST /api/admin/borrower-reminders/process] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}
