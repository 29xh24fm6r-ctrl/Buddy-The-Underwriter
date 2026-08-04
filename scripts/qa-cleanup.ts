#!/usr/bin/env npx tsx
/**
 * P0-3: Protected CLI for QA test-data cleanup.
 *
 * This is a privileged internal operation — not a public web route.
 * Uses the `cleanup_test_data` RPC which runs inside a single transaction
 * (P0-10) and records an audit trail.
 *
 * Usage:
 *   # Dry-run (default, safe):
 *   npx tsx scripts/qa-cleanup.ts
 *
 *   # Dry-run with filter:
 *   npx tsx scripts/qa-cleanup.ts --test-run-id E2E-20260804-120000-abc123
 *
 *   # Confirmed deletion:
 *   npx tsx scripts/qa-cleanup.ts --confirm
 *
 * Environment:
 *   SUPABASE_SERVICE_ROLE_KEY — must be set (never committed)
 *   NEXT_PUBLIC_SUPABASE_URL — must be set
 *
 * This script fails fast if it cannot authenticate — no anonymous access.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function parseArgs(): {
  testRunId?: string;
  dateFrom?: string;
  dateTo?: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const result: ReturnType<typeof parseArgs> = { dryRun: true };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--test-run-id" && i + 1 < args.length) {
      result.testRunId = args[++i];
    } else if (args[i] === "--date-from" && i + 1 < args.length) {
      result.dateFrom = args[++i];
    } else if (args[i] === "--date-to" && i + 1 < args.length) {
      result.dateTo = args[++i];
    } else if (args[i] === "--confirm") {
      result.dryRun = false;
    }
  }

  return result;
}

async function main() {
  const { testRunId, dateFrom, dateTo, dryRun } = parseArgs();

  if (!dryRun) {
    console.log("⚠️  CONFIRMED DELETION requested. This will permanently delete QA test data.");
    console.log("   Press Ctrl+C within 5 seconds to abort...");
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(
    dryRun ? "🔍 DRY RUN" : "🗑️ CONFIRMED DELETION",
  );
  if (testRunId) console.log("   testRunId:", testRunId);
  if (dateFrom) console.log("   dateFrom:", dateFrom);
  if (dateTo) console.log("   dateTo:", dateTo);

  const { data, error } = await sb.rpc("cleanup_test_data", {
    p_test_run_id: testRunId ?? null,
    p_date_from: dateFrom ?? null,
    p_date_to: dateTo ?? null,
    p_dry_run: dryRun,
    p_operated_by: `cli-${process.env.USER ?? "unknown"}@${new Date().toISOString()}`,
  });

  if (error) {
    console.error(`ERROR: RPC failed: ${error.message}`);
    process.exit(1);
  }

  const result = data as any;
  if (!result.ok) {
    console.error(`ERROR: ${result.error}`);
    process.exit(1);
  }

  console.log(`✅ Done. matched=${result.matched_count}, deals_deleted=${result.deals_deleted ?? 0}`);

  if (!dryRun && result.deal_ids?.length) {
    console.log(`   Deleted deals: ${(result.deal_ids as string[]).join(", ")}`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
