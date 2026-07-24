#!/usr/bin/env tsx
/**
 * Notification Delivery — live wiring.
 *
 * Was: console.log("Module present. No DB.") + exit(0) — no logic at all.
 *
 * Real underlying implementation exists: src/lib/brokerage/commsOrchestrator.ts
 * (runBrokerageCommsBatch) processes the real brokerage_comms_outbox /
 * brokerage_lender_message_outbox queues via commsAdapters.ts, whose send
 * behavior is gated by the real BROKERAGE_COMMS_MODE env var (stub |
 * dry_run | live — see commsAdapters.ts).
 *
 * This script deliberately does NOT invoke runBrokerageCommsBatch /
 * processDueCommsOutbox: that call enqueues new outbox rows against real
 * deals and, if it actually processed the queue, would consume real pending
 * sends — even in dry_run mode, "processing" a message flips its outbox row
 * to sent/failed, which would silently swallow messages a live cron was
 * meant to deliver. An ops status check must not have that side effect, so
 * instead it reports the true live queue/adapter state, read-only:
 *   - configured BROKERAGE_COMMS_MODE and adapter env readiness
 *   - real pending/sending/retry/sent/failed counts from both outbox tables
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCommsMode, assertCommsEnvReady } from "@/lib/brokerage/commsAdapters";

const json = process.argv.includes("--json");
const STATUSES = ["pending", "sending", "retry_scheduled", "sent", "failed"] as const;

async function countByStatus(sb: ReturnType<typeof supabaseAdmin>, table: string) {
  const counts: Record<string, number> = {};
  for (const status of STATUSES) {
    const { count, error } = await sb.from(table).select("id", { count: "exact", head: true }).eq("status", status);
    if (error) { counts[status] = -1; continue; }
    counts[status] = count ?? 0;
  }
  return counts;
}

async function main() {
  console.log("NOTIFICATION DELIVERY");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const envStatus = assertCommsEnvReady();

  if (!url || !key) {
    console.log(`Mode: ${envStatus.mode} — No DB, queue counts unavailable.`);
    for (const issue of envStatus.issues) console.log(`  !! ${issue}`);
    process.exit(2);
    return;
  }

  const sb = supabaseAdmin();
  const [borrowerCounts, lenderCounts] = await Promise.all([
    countByStatus(sb, "brokerage_comms_outbox"),
    countByStatus(sb, "brokerage_lender_message_outbox"),
  ]);

  const mode = getCommsMode();
  const liveNotReady = mode === "live" && envStatus.issues.length > 0;

  if (json) {
    console.log(JSON.stringify({ mode, envStatus, borrowerOutbox: borrowerCounts, lenderOutbox: lenderCounts }, null, 2));
  } else {
    console.log(`Mode: ${mode}  resend_ready=${envStatus.resendReady} telnyx_ready=${envStatus.telnyxReady} slack_ready=${envStatus.slackReady}`);
    for (const issue of envStatus.issues) console.log(`  !! ${issue}`);
    console.log(`Borrower outbox (brokerage_comms_outbox): ${JSON.stringify(borrowerCounts)}`);
    console.log(`Lender outbox (brokerage_lender_message_outbox): ${JSON.stringify(lenderCounts)}`);
    if (liveNotReady) console.log("  !! Mode is 'live' but adapter env is not fully configured — real sends would fail.");
    console.log(liveNotReady ? "FAILED" : "PASSED");
  }
  process.exit(liveNotReady ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
