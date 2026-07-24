#!/usr/bin/env tsx
/**
 * BRK-10K Daily Ops — live wiring.
 *
 * Was: buildDailyOpsReport() called with every input array hardcoded to [],
 * so it always reported GREEN regardless of real deal state. This loads each
 * of the report's real inputs from Supabase (table/column names verified via
 * `grep -rn '.from("...")' src/`) and feeds it live data.
 *
 * Row-count bounds: most arrays are fetched unbounded-by-date (only a
 * `.limit()` safety cap) because buildDailyOpsReport needs full history for
 * correctness — e.g. a funded deal from months ago must still count against
 * `missingVerification`, and a fee-ledger row from any date still matters for
 * the two-masters-consent check. The only field that is safely time-windowed
 * is `sessions` (only used for "new sessions today").
 *
 * `concierges` and `accesses` inputs are intentionally left empty: grepping
 * `input.concierges` / `input.accesses` in dailyOps.ts shows neither field is
 * ever read by buildDailyOpsReport, so fetching them would be dead work.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildDailyOpsReport, type DailyOpsInput } from "@/lib/brokerage/dailyOps";

const json = process.argv.includes("--json");

// Deals in these statuses are no longer "in flight" for ops purposes —
// mirrors CLOSED_STATUSES used elsewhere (borrowerNudges.ts, bankerAlerts.ts).
const TERMINAL_DEAL_STATUSES = ["closed", "declined", "funded", "archived", "docs_complete"];
const SAFETY_LIMIT = 5000;

type Row = Record<string, any>;

async function loadDailyOpsInputs(now: Date): Promise<Omit<DailyOpsInput, "now">> {
  const sb = supabaseAdmin();
  const sessionsSince = new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString();

  const [
    sessionsRes,
    dealsRes,
    storiesRes,
    documentsRes,
    scoresRes,
    tridentsRes,
    sealedRes,
    listingsRes,
    claimsRes,
    picksRes,
    workflowsRes,
    conditionsRes,
    fundingRes,
    feeLedgerRes,
    disclosuresRes,
    form159Res,
  ] = await Promise.all([
    sb.from("borrower_session_tokens").select("deal_id, created_at").gte("created_at", sessionsSince).limit(SAFETY_LIMIT),
    sb.from("deals").select("id, updated_at, status").not("status", "in", `(${TERMINAL_DEAL_STATUSES.join(",")})`).limit(SAFETY_LIMIT),
    sb.from("buddy_borrower_stories").select("deal_id").limit(SAFETY_LIMIT),
    // Only non-finalized docs matter to daily ops (pending / stuck-upload check).
    sb.from("deal_documents").select("id, deal_id, finalized_at, uploaded_at").is("finalized_at", null).limit(SAFETY_LIMIT),
    sb.from("buddy_sba_scores").select("deal_id, score_status").limit(SAFETY_LIMIT),
    sb.from("buddy_trident_bundles").select("deal_id, status").limit(SAFETY_LIMIT),
    sb.from("buddy_sealed_packages").select("deal_id").limit(SAFETY_LIMIT),
    sb.from("marketplace_listings").select("id, deal_id, status, claim_closes_at").limit(SAFETY_LIMIT),
    sb.from("marketplace_claims").select("id, listing_id, status").limit(SAFETY_LIMIT),
    sb.from("marketplace_picks").select("id, listing_id, status").limit(SAFETY_LIMIT),
    sb.from("brokerage_closing_workflows").select("id, deal_id, status").limit(SAFETY_LIMIT),
    sb.from("brokerage_closing_conditions").select("id, status, due_date").limit(SAFETY_LIMIT),
    // funded_at is used in place of created_at — brokerage_funding_verifications
    // has no confirmed created_at column in any select() across the codebase,
    // but verifyDealFunding() always sets funded_at, so it's a safe stand-in
    // for "when this verification happened".
    sb.from("brokerage_funding_verifications").select("deal_id, status, funded_at").limit(SAFETY_LIMIT),
    sb.from("brokerage_fee_ledger").select("deal_id, fee_type, status, amount_cents, funding_verified_at").limit(SAFETY_LIMIT),
    sb.from("brokerage_disclosures").select("deal_id, disclosure_type, status").limit(SAFETY_LIMIT),
    sb.from("sba_form_159_records").select("deal_id").limit(SAFETY_LIMIT),
  ]);

  const warn = (label: string, error: any) => {
    if (error) console.error(`  !! ${label}: ${error.message ?? error}`);
  };
  warn("borrower_session_tokens", sessionsRes.error);
  warn("deals", dealsRes.error);
  warn("buddy_borrower_stories", storiesRes.error);
  warn("deal_documents", documentsRes.error);
  warn("buddy_sba_scores", scoresRes.error);
  warn("buddy_trident_bundles", tridentsRes.error);
  warn("buddy_sealed_packages", sealedRes.error);
  warn("marketplace_listings", listingsRes.error);
  warn("marketplace_claims", claimsRes.error);
  warn("marketplace_picks", picksRes.error);
  warn("brokerage_closing_workflows", workflowsRes.error);
  warn("brokerage_closing_conditions", conditionsRes.error);
  warn("brokerage_funding_verifications", fundingRes.error);
  warn("brokerage_fee_ledger", feeLedgerRes.error);
  warn("brokerage_disclosures", disclosuresRes.error);
  warn("sba_form_159_records", form159Res.error);

  const documents = ((documentsRes.data ?? []) as Row[]).map((d) => ({ ...d, created_at: d.uploaded_at }));
  const fundingVerifications = ((fundingRes.data ?? []) as Row[]).map((v) => ({ ...v, created_at: v.funded_at }));

  return {
    sessions: (sessionsRes.data ?? []) as Row[],
    deals: (dealsRes.data ?? []) as Row[],
    concierges: [],
    stories: (storiesRes.data ?? []) as Row[],
    documents,
    scores: (scoresRes.data ?? []) as Row[],
    tridents: (tridentsRes.data ?? []) as Row[],
    sealedPackages: (sealedRes.data ?? []) as Row[],
    listings: (listingsRes.data ?? []) as Row[],
    claims: (claimsRes.data ?? []) as Row[],
    picks: (picksRes.data ?? []) as Row[],
    accesses: [],
    closingWorkflows: (workflowsRes.data ?? []) as Row[],
    closingConditions: (conditionsRes.data ?? []) as Row[],
    fundingVerifications,
    feeLedger: (feeLedgerRes.data ?? []) as Row[],
    disclosures: (disclosuresRes.data ?? []) as Row[],
    form159Records: (form159Res.data ?? []) as Row[],
  };
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("BROKERAGE DAILY OPS");
    console.log("No DB — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against live data.");
    process.exit(2);
    return;
  }

  const now = new Date();
  const inputs = await loadDailyOpsInputs(now);
  const r = buildDailyOpsReport({ now, ...inputs });

  if (json) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log("BROKERAGE DAILY OPS");
    console.log(`Status: ${r.status}  Critical: ${r.criticalActions.length}  Followups: ${r.followups.length}`);
    for (const a of r.criticalActions) console.log(`  !! [${a.category}] ${a.message} — ${a.action}`);
    for (const a of r.followups) console.log(`  -  [${a.category}] ${a.message} — ${a.action}`);
    console.log(`Borrower: ${JSON.stringify(r.borrower)}`);
    console.log(`Marketplace: ${JSON.stringify(r.marketplace)}`);
    console.log(`Closing: ${JSON.stringify(r.closing)}`);
    console.log(`Revenue: ${JSON.stringify(r.revenue)}`);
    console.log(`Compliance: ${JSON.stringify(r.compliance)}`);
  }
  process.exit(r.status === "RED" ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
