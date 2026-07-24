#!/usr/bin/env tsx
/**
 * Lender Comms — live wiring.
 *
 * Was: console.log("Module present.") + exit(0) — no logic at all.
 *
 * Real underlying implementation exists: src/lib/brokerage/lenderComms.ts.
 * getLenderCommsRecipients(lenderBankId, sb) is a pure read (reads
 * lender_marketplace_agreements.signed_by_email — no writes), so it's safe
 * to run against every live active lender agreement to report whether each
 * onboarded lender actually has a reachable comms recipient configured.
 * This deliberately stops short of queueLenderMessage/sendLenderMessage,
 * which would write real outbox rows / dispatch messages.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getLenderCommsRecipients } from "@/lib/brokerage/lenderComms";

const json = process.argv.includes("--json");
const SAMPLE_LIMIT = 200;
type Row = Record<string, any>;
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
  console.log("LENDER COMMS");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against live data.");
    process.exit(2);
    return;
  }

  const sb = supabaseAdmin();
  const outboxCounts = await countByStatus(sb, "brokerage_lender_message_outbox");

  const { data: agreements, error } = await sb
    .from("lender_marketplace_agreements")
    .select("lender_bank_id")
    .eq("status", "active")
    .limit(SAMPLE_LIMIT);

  if (error) {
    console.error(`  !! lender_marketplace_agreements: ${error.message}`);
    process.exit(1);
    return;
  }

  const rows = (agreements ?? []) as Row[];
  let reachable = 0;
  const unreachable: string[] = [];
  const seen = new Set<string>();
  for (const a of rows) {
    const lenderBankId = String(a.lender_bank_id);
    if (seen.has(lenderBankId)) continue;
    seen.add(lenderBankId);
    const recipients = await getLenderCommsRecipients(lenderBankId, sb as any);
    if (recipients.length > 0) reachable++;
    else unreachable.push(lenderBankId);
  }

  if (json) {
    console.log(JSON.stringify({ outboxCounts, activeLenders: seen.size, reachable, unreachable }, null, 2));
  } else {
    console.log(`Outbox (brokerage_lender_message_outbox): ${JSON.stringify(outboxCounts)}`);
    console.log(`Active lender agreements checked: ${seen.size}`);
    console.log(`Reachable (has signed_by_email): ${reachable}`);
    for (const id of unreachable) console.log(`  !! Lender bank ${id}: no comms recipient configured`);
  }
  process.exit(unreachable.length > 0 && seen.size > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
