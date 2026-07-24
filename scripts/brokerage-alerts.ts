#!/usr/bin/env tsx
/**
 * BRK-10L Alerting — live wiring.
 *
 * Was: console.log("Module present. No DB.") + exit(0) — no logic at all.
 *
 * Real underlying implementation exists: src/lib/brokerage/alerting.ts
 * (listActiveAlerts / buildAlertDigest / generateBrokerageAlerts), backed by
 * the real brokerage_alerts / brokerage_alert_events tables.
 *
 * Default mode is read-only: reports the live alert digest
 * (active critical/warning alerts + anything resolved in the last 24h).
 * Pass --generate to also recompute today's daily-ops report from live data
 * and run generateBrokerageAlerts() against it, which upserts/dedupes real
 * alert rows (this is the same write path the real ops cron would use — it
 * does not send any SMS/email, it only persists alert records that
 * brokerage-notify.ts / a human dashboard would read later).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildDailyOpsReport, type DailyOpsInput } from "@/lib/brokerage/dailyOps";
import { listActiveAlerts, buildAlertDigest, generateBrokerageAlerts } from "@/lib/brokerage/alerting";

const json = process.argv.includes("--json");
const generate = process.argv.includes("--generate");
const TERMINAL_DEAL_STATUSES = ["closed", "declined", "funded", "archived", "docs_complete"];
const SAFETY_LIMIT = 5000;
type Row = Record<string, any>;

// Same loader as scripts/brokerage-daily-ops.ts — duplicated deliberately so
// this script stays a self-contained CLI entry point (see that script for
// the reasoning behind the bounds/column choices).
async function loadDailyOpsInputs(now: Date): Promise<Omit<DailyOpsInput, "now">> {
  const sb = supabaseAdmin();
  const sessionsSince = new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString();
  const [sessionsRes, dealsRes, storiesRes, documentsRes, scoresRes, tridentsRes, sealedRes, listingsRes, claimsRes, picksRes, workflowsRes, conditionsRes, fundingRes, feeLedgerRes, disclosuresRes, form159Res] = await Promise.all([
    sb.from("borrower_session_tokens").select("deal_id, created_at").gte("created_at", sessionsSince).limit(SAFETY_LIMIT),
    sb.from("deals").select("id, updated_at, status").not("status", "in", `(${TERMINAL_DEAL_STATUSES.join(",")})`).limit(SAFETY_LIMIT),
    sb.from("buddy_borrower_stories").select("deal_id").limit(SAFETY_LIMIT),
    sb.from("deal_documents").select("id, deal_id, finalized_at, uploaded_at").is("finalized_at", null).limit(SAFETY_LIMIT),
    sb.from("buddy_sba_scores").select("deal_id, score_status").limit(SAFETY_LIMIT),
    sb.from("buddy_trident_bundles").select("deal_id, status").limit(SAFETY_LIMIT),
    sb.from("buddy_sealed_packages").select("deal_id").limit(SAFETY_LIMIT),
    sb.from("marketplace_listings").select("id, deal_id, status, claim_closes_at").limit(SAFETY_LIMIT),
    sb.from("marketplace_claims").select("id, listing_id, status").limit(SAFETY_LIMIT),
    sb.from("marketplace_picks").select("id, listing_id, status").limit(SAFETY_LIMIT),
    sb.from("brokerage_closing_workflows").select("id, deal_id, status").limit(SAFETY_LIMIT),
    sb.from("brokerage_closing_conditions").select("id, status, due_date").limit(SAFETY_LIMIT),
    sb.from("brokerage_funding_verifications").select("deal_id, status, funded_at").limit(SAFETY_LIMIT),
    sb.from("brokerage_fee_ledger").select("deal_id, fee_type, status, amount_cents, funding_verified_at").limit(SAFETY_LIMIT),
    sb.from("brokerage_disclosures").select("deal_id, disclosure_type, status").limit(SAFETY_LIMIT),
    sb.from("sba_form_159_records").select("deal_id").limit(SAFETY_LIMIT),
  ]);
  const documents = ((documentsRes.data ?? []) as Row[]).map((d) => ({ ...d, created_at: d.uploaded_at }));
  const fundingVerifications = ((fundingRes.data ?? []) as Row[]).map((v) => ({ ...v, created_at: v.funded_at }));
  return {
    sessions: (sessionsRes.data ?? []) as Row[], deals: (dealsRes.data ?? []) as Row[], concierges: [],
    stories: (storiesRes.data ?? []) as Row[], documents, scores: (scoresRes.data ?? []) as Row[],
    tridents: (tridentsRes.data ?? []) as Row[], sealedPackages: (sealedRes.data ?? []) as Row[],
    listings: (listingsRes.data ?? []) as Row[], claims: (claimsRes.data ?? []) as Row[], picks: (picksRes.data ?? []) as Row[],
    accesses: [], closingWorkflows: (workflowsRes.data ?? []) as Row[], closingConditions: (conditionsRes.data ?? []) as Row[],
    fundingVerifications, feeLedger: (feeLedgerRes.data ?? []) as Row[], disclosures: (disclosuresRes.data ?? []) as Row[],
    form159Records: (form159Res.data ?? []) as Row[],
  };
}

async function main() {
  console.log("BROKERAGE ALERTS");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against live data.");
    process.exit(2);
    return;
  }

  const sb = supabaseAdmin();

  if (generate) {
    const now = new Date();
    const inputs = await loadDailyOpsInputs(now);
    const report = buildDailyOpsReport({ now, ...inputs });
    const genResult = await generateBrokerageAlerts(report, sb as any);
    console.log(`Generated from live daily-ops report (status=${report.status}): created=${genResult.created} recurred=${genResult.recurred} autoResolved=${genResult.autoResolved} total=${genResult.total}`);
  }

  const digest = await buildAlertDigest(sb as any);
  const active = await listActiveAlerts(sb as any);

  if (json) {
    console.log(JSON.stringify({ digest, active }, null, 2));
  } else {
    console.log(digest.digestText);
    for (const a of digest.activeCritical) console.log(`  !! [CRITICAL] ${a.title} (deal ${a.dealId ?? "n/a"}, seen ${a.occurrenceCount}x)`);
    for (const a of digest.activeWarnings) console.log(`  -  [WARNING] ${a.title} (deal ${a.dealId ?? "n/a"})`);
  }

  process.exit(digest.activeCritical.length > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
