/**
 * POST /api/cron/nightly
 *
 * Nightly cron job for automated governance tasks:
 * 0. Telemetry retention purge (buddy_system_events / franchise_sync_runs /
 *    buddy_workers) — global, not per-bank.
 * 1. Portfolio aggregation (system-wide risk snapshot)
 * 2. Policy drift detection (compare actual to stated policy)
 * 3. Living policy suggestions (AI-driven policy updates)
 *
 * Trigger via Vercel Cron or Supabase Edge Functions.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { aggregatePortfolio } from "@/lib/macro/aggregatePortfolio";
import { detectPolicyDrift } from "@/lib/nightly/policyDrift";
import { suggestPolicyUpdates } from "@/lib/nightly/livingPolicy";
import { runTelemetryRetentionPurge } from "@/lib/nightly/telemetryRetention";
import { runFranchiseSyncJanitor } from "@/lib/nightly/franchiseSyncJanitor";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";

/**
 * Vercel cron issues GET, so GET is the scheduled entry point and POST is kept
 * for manual/external invocation. Both run the same job.
 *
 * SPEC-SYSTEM-DEBLOAT-1 Phase B follow-up: this route holds the telemetry
 * retention purge, but it was never listed in vercel.json's `crons` array, so
 * it had never run. buddy_system_events reached 540,185 rows / 360 MB — 56% of
 * the whole database — while a correct, working purge sat one schedule entry
 * away. Scheduled as of 2026-08-26.
 */
export async function GET(req: NextRequest) {
  return runNightly(req);
}

export async function POST(req: NextRequest) {
  return runNightly(req);
}

async function runNightly(req: NextRequest) {
  // Constant-time secret check, and fail CLOSED: the previous form
  // (`if (cronSecret && ...)`) skipped the check entirely whenever
  // CRON_SECRET was unset, leaving the job open to anonymous invocation.
  if (!hasValidWorkerSecret(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const sb = supabaseAdmin();

  // 0. Telemetry retention purge — global, runs regardless of bank count.
  // A missing/broken purge RPC is a loud failure (SPEC-SYSTEM-DEBLOAT-1
  // Phase B): it is reported in the response, not swallowed.
  let retention: { ok: true; results: Awaited<ReturnType<typeof runTelemetryRetentionPurge>> } | { ok: false; error: string };
  try {
    const results = await runTelemetryRetentionPurge(sb);
    retention = { ok: true, results };
  } catch (error: any) {
    console.error("Telemetry retention purge failed:", error);
    retention = { ok: false, error: error.message ?? String(error) };
  }

  // 0b. Franchise sync hygiene — finalize orphaned 'running' rows and surface
  // sources that are silently degraded or have gone quiet
  // (SPEC-FRANCHISE-SYNC-HYGIENE-1). Non-fatal: reported, never thrown, so a
  // janitor problem cannot block the retention purge or the per-bank work.
  let franchiseSync:
    | { ok: true; result: Awaited<ReturnType<typeof runFranchiseSyncJanitor>> }
    | { ok: false; error: string };
  try {
    franchiseSync = { ok: true, result: await runFranchiseSyncJanitor(sb) };
  } catch (error: any) {
    console.error("Franchise sync janitor failed:", error);
    franchiseSync = { ok: false, error: error?.message ?? String(error) };
  }

  // Fetch all banks
  const { data: banks } = await sb.from("banks").select("id");

  if (!banks || banks.length === 0) {
    return NextResponse.json({ ok: true, message: "No banks to process", retention, franchiseSync });
  }

  const results = [];

  for (const bank of banks) {
    try {
      console.log(`Processing nightly tasks for bank ${bank.id}`);

      // 1. Aggregate portfolio. A bank with no final decisions is a normal
      // lifecycle state; keep running the remaining no-op-safe governance
      // checks and report the skip explicitly.
      const portfolio = await aggregatePortfolio(bank.id);
      if (portfolio) {
        console.log(`✓ Portfolio aggregated for ${bank.id}`);
      } else {
        console.log(`Portfolio skipped for ${bank.id}: no final decisions`);
      }

      // 2. Detect policy drift
      await detectPolicyDrift(bank.id);
      console.log(`✓ Policy drift detected for ${bank.id}`);

      // 3. Suggest policy updates
      await suggestPolicyUpdates(bank.id);
      console.log(`✓ Policy suggestions generated for ${bank.id}`);

      results.push({
        bank_id: bank.id,
        status: "success",
        portfolio: portfolio ? "aggregated" : "skipped_no_final_decisions",
      });
    } catch (error: any) {
      console.error(`Error processing bank ${bank.id}:`, error);
      results.push({
        bank_id: bank.id,
        status: "error",
        error: error.message
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
    retention,
    franchiseSync,
  });
}
