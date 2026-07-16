#!/usr/bin/env tsx
/**
 * BRK-10I Revenue Reconciliation — live wiring.
 *
 * Was: imported runRevenueReconciliation but never called it — printed
 * "Module present" and exited 0 unconditionally.
 *
 * Now: actually calls runRevenueReconciliation(sb), which itself queries
 * brokerage_closing_workflows / brokerage_funding_verifications /
 * brokerage_fee_ledger / brokerage_revenue_events live — no extra data
 * loading needed here, it takes the Supabase client directly.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runRevenueReconciliation } from "@/lib/brokerage/revenueOps";

const json = process.argv.includes("--json");

async function main() {
  console.log("REVENUE CHECK");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against live data.");
    process.exit(2);
    return;
  }

  const sb = supabaseAdmin();
  const result = await runRevenueReconciliation(sb as any);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Funded deals: ${result.fundedDeals}`);
    console.log(`Missing verification: ${result.missingVerification}`);
    console.log(`Fee ledger mismatches: ${result.feeLedgerMismatches}`);
    console.log(`Revenue events: ${result.revenueEventCount}`);
    console.log(`Total borrower fees: $${(result.totalBorrowerFees / 100).toFixed(2)}`);
    console.log(`Total lender fees: $${(result.totalLenderFees / 100).toFixed(2)}`);
    for (const issue of result.criticalIssues) console.log(`  !! ${issue}`);
    console.log(result.criticalIssues.length === 0 ? "PASSED" : "FAILED");
  }
  process.exit(result.criticalIssues.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
