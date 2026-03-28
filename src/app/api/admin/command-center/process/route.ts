import "server-only";

/**
 * POST /api/admin/command-center/process
 *
 * Background snapshot processor.
 * Auth: Bearer token (CRON_SECRET) for cron/admin use.
 * Purpose: precompute queue snapshots for fast rendering.
 */

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildBankerQueueSurface,
  writeBankerQueueSnapshot,
} from "@/core/command-center/buildBankerQueueSurface";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  // Get all active banks
  const { data: banks } = await sb
    .from("banks")
    .select("id");

  if (!banks || banks.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No banks to process",
      processed: 0,
    });
  }

  let processed = 0;
  let errors = 0;

  for (const bank of banks) {
    try {
      // Use a system user ID for background processing
      const surface = await buildBankerQueueSurface(
        bank.id,
        "system",
        {},
      );
      await writeBankerQueueSnapshot(bank.id, surface.items);
      processed++;
    } catch (err) {
      console.error(
        `[command-center/process] Failed for bank ${bank.id}:`,
        err,
      );
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    processed,
    errors,
    totalBanks: banks.length,
  });
}
