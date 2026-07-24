#!/usr/bin/env tsx
/**
 * BRK-10C Security Audit — live wiring.
 *
 * Was: runSecurityAudit() called against 3 hand-typed fake routes (all
 * marked resolvesIdentityServerSide:true) and 5 hand-typed fake rate-limit
 * specs (all hasRateLimit:true) — so api_safety and rate_limit checks always
 * passed no matter what the real route files said, and lender/package/
 * redaction checks ran against empty arrays (0 rows = trivially "verified").
 *
 * Now: routes + rate limits come from scanBrokerageRoutes() (already used by
 * businessReadinessGate.ts / launchGate.ts), which parses every real
 * src/app/api/brokerage/** and src/app/api/lender/** route.ts file for real
 * auth primitives and rate-limit markers. dbData (listings/claims/agreements/
 * banks/accesses/picks/deals) is loaded live from Supabase. borrowerIsolation
 * uses real borrower_session_tokens rows instead of two invented tokenHash
 * strings. adminPayloads replays the exact query used by the real admin
 * sessions page (src/app/admin/brokerage/sessions/page.tsx) to check it
 * doesn't leak token hashes.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runSecurityAudit } from "@/lib/brokerage/securityAudit";
import { scanBrokerageRoutes } from "@/lib/brokerage/brokerageRouteScan";

const json = process.argv.includes("--json");
const LIMIT = 500;
type Row = Record<string, any>;

function printResult(result: ReturnType<typeof runSecurityAudit>, note: string | null) {
  if (json) {
    console.log(JSON.stringify({ ...result, note }, null, 2));
    return;
  }
  for (const f of result.findings) {
    if (f.severity === "info") continue;
    console.log(`  [${f.severity.toUpperCase()}] (${f.category}/${f.check}) ${f.route}: ${f.message} — ${f.repair}`);
  }
  console.log(`Total: ${result.total}  Critical: ${result.critical}  Warning: ${result.warning}  Info: ${result.info}`);
  console.log(result.ok ? "PASSED" : "FAILED");
}

async function main() {
  console.log("BROKERAGE SECURITY AUDIT");

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const { routes, rateLimits } = scanBrokerageRoutes();

  if (!url || !key) {
    console.log("No DB — running route-scan checks only (api_safety, rate_limit). Lender/package/redaction/borrower checks need a DB.");
    const result = runSecurityAudit({
      borrowerIsolation: { sessionA: { tokenHash: "no-db-a", dealId: "no-db-da" }, sessionB: { tokenHash: "no-db-b", dealId: "no-db-db" }, resolveSession: () => null, resolveExpired: () => null },
      lenderIsolation: { listings: [], claims: [], agreements: [], banks: [] },
      packageAccess: { accesses: [], claims: [], picks: [], listings: [] },
      redaction: { listings: [], deals: [] },
      adminPayloads: { payloads: [] },
      apiMethodSafety: { routes },
      rateLimits: { specs: rateLimits },
      categories: ["api", "rate-limit"],
    });
    printResult(result, "No DB — only route-scan categories (api, rate-limit) were checked.");
    process.exit(result.ok ? 0 : 1);
    return;
  }

  const sb = supabaseAdmin();

  const [listingsRes, claimsRes, agreementsRes, banksRes, accessesRes, picksRes, dealsRes, tokensRes] = await Promise.all([
    sb.from("marketplace_listings").select("id, deal_id, status, matched_lender_bank_ids, kfs").limit(LIMIT),
    sb.from("marketplace_claims").select("id, listing_id, lender_bank_id, status").limit(LIMIT),
    sb.from("lender_marketplace_agreements").select("lender_bank_id, status").limit(LIMIT),
    sb.from("banks").select("id, bank_kind").limit(LIMIT),
    sb.from("marketplace_package_access").select("id, listing_id, claim_id, revoked_at, access_level").limit(LIMIT),
    sb.from("marketplace_picks").select("id, listing_id, claim_id, status").limit(LIMIT),
    sb.from("deals").select("id, borrower_name, borrower_email").limit(LIMIT),
    // Real borrower_session_tokens — used to drive borrowerIsolation with a
    // genuine hash->deal_id resolver instead of two invented strings.
    sb.from("borrower_session_tokens").select("token_hash, deal_id, expires_at").order("created_at", { ascending: false }).limit(200),
  ]);

  for (const [label, res] of [
    ["marketplace_listings", listingsRes], ["marketplace_claims", claimsRes], ["lender_marketplace_agreements", agreementsRes],
    ["banks", banksRes], ["marketplace_package_access", accessesRes], ["marketplace_picks", picksRes],
    ["deals", dealsRes], ["borrower_session_tokens", tokensRes],
  ] as const) {
    if ((res as any).error) console.error(`  !! ${label}: ${(res as any).error.message}`);
  }

  // ── borrowerIsolation: build a real hash->session map from live tokens ────
  const tokenRows = (tokensRes.data ?? []) as Row[];
  const tokenMap = new Map<string, { deal_id: string }>();
  for (const t of tokenRows) if (t.token_hash) tokenMap.set(String(t.token_hash), { deal_id: String(t.deal_id) });
  const distinctDealSessions: Row[] = [];
  const seenDeals = new Set<string>();
  for (const t of tokenRows) {
    if (!seenDeals.has(String(t.deal_id))) { seenDeals.add(String(t.deal_id)); distinctDealSessions.push(t); }
    if (distinctDealSessions.length >= 2) break;
  }
  const haveTwoLiveSessions = distinctDealSessions.length >= 2;
  const resolveSession = (h: string) => (h && tokenMap.has(h) ? tokenMap.get(h)! : null);
  const now = Date.now();
  const expiredLive = tokenRows.find((t) => t.expires_at && new Date(t.expires_at).getTime() < now);
  const resolveExpired = (h: string) => {
    if (expiredLive && h === String(expiredLive.token_hash)) return { deal_id: String(expiredLive.deal_id), expires_at: String(expiredLive.expires_at) };
    return null;
  };

  const categories = ["lender", "package", "redaction", "admin", "api", "rate-limit"];
  if (haveTwoLiveSessions) categories.push("borrower");

  // ── adminPayloads: replay the real admin sessions-page query ──────────────
  const since24h = new Date(now - 24 * 3_600_000).toISOString();
  const { data: adminSessionRows } = await sb
    .from("borrower_session_tokens")
    .select("deal_id, created_at, last_seen_at, claimed_email")
    .gte("created_at", since24h)
    .order("created_at", { ascending: false })
    .limit(50);
  const adminPayloads = ((adminSessionRows ?? []) as Row[]).map((row) => ({ source: "admin/brokerage/sessions", data: row }));

  const result = runSecurityAudit({
    borrowerIsolation: haveTwoLiveSessions
      ? { sessionA: { tokenHash: String(distinctDealSessions[0].token_hash), dealId: String(distinctDealSessions[0].deal_id) }, sessionB: { tokenHash: String(distinctDealSessions[1].token_hash), dealId: String(distinctDealSessions[1].deal_id) }, resolveSession, resolveExpired }
      : { sessionA: { tokenHash: "insufficient-live-data-a", dealId: "n/a" }, sessionB: { tokenHash: "insufficient-live-data-b", dealId: "n/a" }, resolveSession: () => null, resolveExpired: () => null },
    lenderIsolation: { listings: (listingsRes.data ?? []) as Row[], claims: (claimsRes.data ?? []) as Row[], agreements: (agreementsRes.data ?? []) as Row[], banks: (banksRes.data ?? []) as Row[] },
    packageAccess: { accesses: (accessesRes.data ?? []) as Row[], claims: (claimsRes.data ?? []) as Row[], picks: (picksRes.data ?? []) as Row[], listings: (listingsRes.data ?? []) as Row[] },
    redaction: { listings: (listingsRes.data ?? []) as Row[], deals: (dealsRes.data ?? []) as Row[] },
    adminPayloads: { payloads: adminPayloads },
    apiMethodSafety: { routes },
    rateLimits: { specs: rateLimits },
    categories,
  });

  if (!haveTwoLiveSessions) {
    console.log("  note: borrower_isolation skipped — fewer than 2 distinct live borrower sessions found in borrower_session_tokens.");
  }
  printResult(result, null);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
