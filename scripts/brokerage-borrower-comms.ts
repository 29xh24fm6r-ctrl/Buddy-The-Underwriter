#!/usr/bin/env tsx
/**
 * Borrower Comms — live wiring.
 *
 * Was: console.log("Module present.") + exit(0) — no logic at all.
 *
 * Real underlying implementation exists: src/lib/brokerage/borrowerNudges.ts.
 * getBorrowerNudgeEligibility(dealId, sb) is a pure read (deals,
 * borrower_concierge_sessions, deal_documents, deal_document_slots — no
 * writes) so it's safe to run against every live active deal as a report:
 * how many deals are currently nudge-eligible, why the rest are blocked, and
 * whether email/SMS channels are actually reachable for the eligible ones.
 * This deliberately stops short of enqueueBorrowerNudge, which would write
 * real outbox rows.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerNudgeEligibility } from "@/lib/brokerage/borrowerNudges";

const json = process.argv.includes("--json");
const SAMPLE_LIMIT = 200;
type Row = Record<string, any>;
const TERMINAL_DEAL_STATUSES = ["closed", "declined", "funded", "archived", "docs_complete"];

async function main() {
  console.log("BORROWER COMMS");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against live data.");
    process.exit(2);
    return;
  }

  const sb = supabaseAdmin();
  const { data: deals, error } = await sb
    .from("deals")
    .select("id, status")
    .not("status", "in", `(${TERMINAL_DEAL_STATUSES.join(",")})`)
    .order("updated_at", { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) {
    console.error(`  !! deals: ${error.message}`);
    process.exit(1);
    return;
  }

  const rows = (deals ?? []) as Row[];
  let eligible = 0;
  let emailOnly = 0;
  let smsCapable = 0;
  const skipReasons: Record<string, number> = {};
  const details: Array<{ dealId: string } & Awaited<ReturnType<typeof getBorrowerNudgeEligibility>>> = [];

  for (const d of rows) {
    const elig = await getBorrowerNudgeEligibility(String(d.id), sb as any);
    if (elig.eligible) {
      eligible++;
      if (elig.smsAllowed) smsCapable++;
      else if (elig.emailAllowed) emailOnly++;
    } else {
      const reason = elig.skipReason ?? "unknown";
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    }
    details.push({ dealId: String(d.id), ...elig });
  }

  if (json) {
    console.log(JSON.stringify({ dealsChecked: rows.length, eligible, emailOnly, smsCapable, skipReasons, details }, null, 2));
  } else {
    console.log(`Active deals checked: ${rows.length}`);
    console.log(`Nudge-eligible: ${eligible} (sms-capable: ${smsCapable}, email-only: ${emailOnly})`);
    for (const [reason, n] of Object.entries(skipReasons)) console.log(`  -  ${n} skipped: ${reason}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
