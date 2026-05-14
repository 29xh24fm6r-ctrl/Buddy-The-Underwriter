#!/usr/bin/env tsx
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { runSecurityAudit } from "../src/lib/brokerage/securityAudit";
async function main() {
  console.log("BROKERAGE SECURITY AUDIT");
  const result = runSecurityAudit({ borrowerIsolation: { sessionA: { tokenHash: "a", dealId: "da" }, sessionB: { tokenHash: "b", dealId: "db" }, resolveSession: h => h === "a" ? { deal_id: "da" } : h === "b" ? { deal_id: "db" } : null, resolveExpired: () => null }, lenderIsolation: { listings: [], claims: [], agreements: [], banks: [] }, packageAccess: { accesses: [], claims: [], picks: [], listings: [] }, redaction: { listings: [], deals: [] }, adminPayloads: { payloads: [{ source: "cli", data: {} }] }, apiMethodSafety: { routes: [{ path: "/api/brokerage/concierge", methods: ["POST"], resolvesIdentityServerSide: true, acceptsClientBankId: false, acceptsClientDealId: false }, { path: "/api/brokerage/marketplace/pick", methods: ["POST"], resolvesIdentityServerSide: true, acceptsClientBankId: false, acceptsClientDealId: false }, { path: "/api/lender/marketplace/claim", methods: ["POST"], resolvesIdentityServerSide: true, acceptsClientBankId: false, acceptsClientDealId: false }] }, rateLimits: { specs: [{ route: "/api/brokerage/concierge", hasRateLimit: true, limitType: "ip" }, { route: "/api/brokerage/discovery", hasRateLimit: true, limitType: "ip" }, { route: "/api/brokerage/uploads", hasRateLimit: true, limitType: "ip" }, { route: "/api/lender/marketplace/claim", hasRateLimit: true, limitType: "authenticated" }, { route: "/api/brokerage/marketplace/pick", hasRateLimit: true, limitType: "session" }] } });
  console.log(`Total: ${result.total}  Critical: ${result.critical}`);
  console.log(result.ok ? "PASSED" : "FAILED");
  process.exit(result.ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
