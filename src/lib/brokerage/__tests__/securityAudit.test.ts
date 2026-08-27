import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const m = require("../securityAudit") as typeof import("../securityAudit");
test("borrower isolation ok", () => { const r=m.auditBorrowerIsolation({sessionA:{tokenHash:"a",dealId:"da"},sessionB:{tokenHash:"b",dealId:"db"},resolveSession:h=>h==="a"?{deal_id:"da"}:h==="b"?{deal_id:"db"}:null,resolveExpired:()=>null}); assert.equal(r.filter(f=>f.severity==="critical").length,0); });
test("expired token", () => { const r=m.auditBorrowerIsolation({sessionA:{tokenHash:"a",dealId:"da"},sessionB:{tokenHash:"b",dealId:"db"},resolveSession:h=>h==="a"?{deal_id:"da"}:null,resolveExpired:h=>h==="expired-token-hash"?{deal_id:"x",expires_at:"2020"}:null}); assert.ok(r.some(f=>f.check==="expired_token")); });
test("missing denied", () => { const r=m.auditBorrowerIsolation({sessionA:{tokenHash:"a",dealId:"da"},sessionB:{tokenHash:"b",dealId:"db"},resolveSession:()=>null,resolveExpired:()=>null}); assert.equal(r.filter(f=>f.severity==="critical").length,0); });
test("unmatched claim", () => { const r=m.auditLenderIsolation({listings:[{id:"l1",matched_lender_bank_ids:["b1"]}],claims:[{id:"c1",listing_id:"l1",lender_bank_id:"bX",status:"active"}],agreements:[{lender_bank_id:"bX",status:"active"}],banks:[{id:"bX",bank_kind:"commercial_bank"}]}); assert.ok(r.some(f=>f.check==="unmatched_lender_claim")); });
test("no agreement", () => { const r=m.auditLenderIsolation({listings:[{id:"l1",matched_lender_bank_ids:["b1"]}],claims:[{id:"c1",listing_id:"l1",lender_bank_id:"b1",status:"active"}],agreements:[{lender_bank_id:"b1",status:"draft"}],banks:[{id:"b1",bank_kind:"commercial_bank"}]}); assert.ok(r.some(f=>f.check==="claim_without_agreement")); });
test("brokerage claim", () => { const r=m.auditLenderIsolation({listings:[{id:"l1",matched_lender_bank_ids:["b1"]}],claims:[{id:"c1",listing_id:"l1",lender_bank_id:"b1",status:"active"}],agreements:[{lender_bank_id:"b1",status:"active"}],banks:[{id:"b1",bank_kind:"brokerage"}]}); assert.ok(r.some(f=>f.check==="brokerage_bank_claim")); });
test("valid lender", () => { assert.equal(m.auditLenderIsolation({listings:[{id:"l1",matched_lender_bank_ids:["b1"]}],claims:[{id:"c1",listing_id:"l1",lender_bank_id:"b1",status:"active"}],agreements:[{lender_bank_id:"b1",status:"active"}],banks:[{id:"b1",bank_kind:"commercial_bank"}]}).filter(f=>f.severity==="critical").length,0); });
test("access not picked", () => { assert.ok(m.auditPackageAccess({accesses:[{id:"a1",claim_id:"c1",listing_id:"l1"}],claims:[{id:"c1",status:"active"}],picks:[{id:"p1",claim_id:"c2",status:"picked"}],listings:[{id:"l1",status:"picked"}]}).some(f=>f.check==="access_not_picked")); });
test("picked no access", () => { assert.ok(m.auditPackageAccess({accesses:[],claims:[{id:"c1",status:"picked"}],picks:[{id:"p1",claim_id:"c1",status:"picked"}],listings:[{id:"l1",status:"picked"}]}).some(f=>f.check==="picked_no_access")); });
test("valid access", () => { assert.equal(m.auditPackageAccess({accesses:[{id:"a1",claim_id:"c1",listing_id:"l1"}],claims:[{id:"c1",status:"picked"}],picks:[{id:"p1",claim_id:"c1",status:"picked"}],listings:[{id:"l1",status:"picked"}]}).filter(f=>f.severity==="critical").length,0); });
test("KFS borrowerName", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{borrowerName:"J"}}],deals:[{id:"d1"}]}).some(f=>f.check==="kfs_contains_borrowerName")); });
test("KFS email", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{note:"a@b.com"}}],deals:[{id:"d1"}]}).some(f=>f.check==="kfs_matches_email")); });
test("KFS SSN", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{note:"123-45-6789"}}],deals:[{id:"d1"}]}).some(f=>f.check==="kfs_matches_SSN")); });
test("KFS EIN", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{note:"12-3456789"}}],deals:[{id:"d1"}]}).some(f=>f.check==="kfs_matches_EIN")); });
test("KFS storage", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{ref:"/trident-bundles/x"}}],deals:[{id:"d1"}]}).some(f=>f.check==="kfs_storage_path")); });
test("KFS name leak", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{note:"jane runs"}}],deals:[{id:"d1",borrower_name:"Jane"}]}).some(f=>f.check==="kfs_leaks_borrower_name")); });
test("clean redaction", () => { assert.equal(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{state:"TX",score:78}}],deals:[{id:"d1",borrower_name:"Secret",borrower_email:"s@s.com"}]}).filter(f=>f.severity==="critical").length,0); });
test("KFS phone", () => { assert.ok(m.auditRedaction({listings:[{id:"l1",deal_id:"d1",status:"claiming",kfs:{note:"Call 555-123-4567"}}],deals:[{id:"d1"}]}).some(f=>f.check==="kfs_matches_phone")); });
test("admin token_hash", () => { assert.ok(m.auditAdminPayloads({payloads:[{source:"ops",data:{token_hash:"x"}}]}).some(f=>f.check==="admin_leaks_secret")); });
test("admin password", () => { assert.ok(m.auditAdminPayloads({payloads:[{source:"ops",data:{password:"x"}}]}).some(f=>f.severity==="critical")); });
test("admin clean", () => { assert.equal(m.auditAdminPayloads({payloads:[{source:"ops",data:{total:5}}]}).filter(f=>f.severity==="critical").length,0); });
test("client identity", () => { assert.ok(m.auditApiMethodSafety({routes:[{path:"/api/brokerage/marketplace/pick",methods:["POST"],resolvesIdentityServerSide:false,acceptsClientBankId:false,acceptsClientDealId:false}]}).some(f=>f.check==="client_identity_trust")); });
test("client bank_id", () => { assert.ok(m.auditApiMethodSafety({routes:[{path:"/api/lender/marketplace/claim",methods:["POST"],resolvesIdentityServerSide:true,acceptsClientBankId:true,acceptsClientDealId:false}]}).some(f=>f.check==="client_bank_id")); });
test("client deal_id", () => { assert.ok(m.auditApiMethodSafety({routes:[{path:"/api/brokerage/marketplace/pick",methods:["POST"],resolvesIdentityServerSide:true,acceptsClientBankId:false,acceptsClientDealId:true}]}).some(f=>f.check==="client_deal_id")); });
test("secure routes", () => { assert.equal(m.auditApiMethodSafety({routes:[{path:"/api/brokerage/marketplace/pick",methods:["POST"],resolvesIdentityServerSide:true,acceptsClientBankId:false,acceptsClientDealId:false},{path:"/api/lender/marketplace/claim",methods:["POST"],resolvesIdentityServerSide:true,acceptsClientBankId:false,acceptsClientDealId:false}]}).filter(f=>f.severity==="critical").length,0); });
test("missing rate limit", () => { assert.ok(m.auditRateLimits({specs:[]}).filter(f=>f.severity==="warning").length>=5); });
test("no rate limit", () => { assert.ok(m.auditRateLimits({specs:[{route:"/api/brokerage/concierge",hasRateLimit:false,limitType:"none"}]}).some(f=>f.check==="no_rate_limit")); });
test("all rates", () => { assert.equal(m.auditRateLimits({specs:[{route:"/api/brokerage/concierge",hasRateLimit:true,limitType:"ip"},{route:"/api/brokerage/discovery",hasRateLimit:true,limitType:"ip"},{route:"/api/brokerage/uploads",hasRateLimit:true,limitType:"ip"},{route:"/api/lender/marketplace/claim",hasRateLimit:true,limitType:"authenticated"},{route:"/api/brokerage/marketplace/pick",hasRateLimit:true,limitType:"session"}]}).filter(f=>f.severity==="critical").length,0); });
test("full clean", () => { const r=m.runSecurityAudit({borrowerIsolation:{sessionA:{tokenHash:"a",dealId:"da"},sessionB:{tokenHash:"b",dealId:"db"},resolveSession:h=>h==="a"?{deal_id:"da"}:h==="b"?{deal_id:"db"}:null,resolveExpired:()=>null},lenderIsolation:{listings:[{id:"l1",matched_lender_bank_ids:["b1"]}],claims:[{id:"c1",listing_id:"l1",lender_bank_id:"b1",status:"active"}],agreements:[{lender_bank_id:"b1",status:"active"}],banks:[{id:"b1",bank_kind:"commercial_bank"}]},packageAccess:{accesses:[{id:"a1",claim_id:"c1",listing_id:"l1"}],claims:[{id:"c1",status:"picked"}],picks:[{id:"p1",claim_id:"c1",status:"picked"}],listings:[{id:"l1",status:"picked"}]},redaction:{listings:[{id:"l1",deal_id:"d1",status:"picked",kfs:{state:"TX"}}],deals:[{id:"d1",borrower_name:"H",borrower_email:"h@h.com"}]},adminPayloads:{payloads:[{source:"x",data:{total:1}}]},apiMethodSafety:{routes:[{path:"/api/brokerage/marketplace/pick",methods:["POST"],resolvesIdentityServerSide:true,acceptsClientBankId:false,acceptsClientDealId:false},{path:"/api/lender/marketplace/claim",methods:["POST"],resolvesIdentityServerSide:true,acceptsClientBankId:false,acceptsClientDealId:false}]},rateLimits:{specs:[{route:"/api/brokerage/concierge",hasRateLimit:true,limitType:"ip"},{route:"/api/brokerage/discovery",hasRateLimit:true,limitType:"ip"},{route:"/api/brokerage/uploads",hasRateLimit:true,limitType:"ip"},{route:"/api/lender/marketplace/claim",hasRateLimit:true,limitType:"authenticated"},{route:"/api/brokerage/marketplace/pick",hasRateLimit:true,limitType:"session"}]}}); assert.equal(r.ok,true); assert.equal(r.critical,0); });
test("category filter", () => { const r=m.runSecurityAudit({borrowerIsolation:{sessionA:{tokenHash:"a",dealId:"d1"},sessionB:{tokenHash:"b",dealId:"d2"},resolveSession:()=>null,resolveExpired:()=>null},lenderIsolation:{listings:[],claims:[],agreements:[],banks:[]},packageAccess:{accesses:[],claims:[],picks:[],listings:[]},redaction:{listings:[],deals:[]},adminPayloads:{payloads:[]},apiMethodSafety:{routes:[]},rateLimits:{specs:[]},categories:["borrower"]}); assert.ok(r.findings.every(f=>f.category==="borrower_isolation")); });

// ── Preview redaction provenance (audit round 3, step 5) ───────────────────
// The system's own redaction audit inspected only marketplace_listings.kfs and
// could not see either preview artifact leak. This check reads the redaction
// provenance stamped on the bundle, so artifacts rendered by a leaky redactor
// are named even after the code that produced them is fixed.

const { auditPreviewRedactionProvenance, MIN_TRUSTED_REDACTOR_VERSION } =
  require("../securityAudit") as typeof import("../securityAudit");

function previewBundle(extra: Record<string, unknown> = {}) {
  return {
    id: "bundle-1", mode: "preview", status: "succeeded",
    superseded_at: null, redactor_version: MIN_TRUSTED_REDACTOR_VERSION, ...extra,
  };
}

test("a current preview bundle passes", () => {
  const f = auditPreviewRedactionProvenance({ bundles: [previewBundle()] });
  assert.equal(f.filter((x) => x.severity === "critical").length, 0);
});

test("a preview bundle from a leaky redactor is flagged critical", () => {
  for (const stale of ["1.0.0", "1.1.0"]) {
    const f = auditPreviewRedactionProvenance({ bundles: [previewBundle({ redactor_version: stale })] });
    const crit = f.filter((x) => x.severity === "critical");
    assert.equal(crit.length, 1, `redactor ${stale} must be flagged`);
    assert.equal(crit[0].check, "preview_stale_redactor_version");
  }
});

test("an unstamped preview bundle is flagged critical", () => {
  const f = auditPreviewRedactionProvenance({ bundles: [previewBundle({ redactor_version: null })] });
  assert.equal(f[0].check, "preview_missing_redactor_version");
  assert.equal(f[0].severity, "critical");
});

test("final and superseded bundles are out of scope", () => {
  const f = auditPreviewRedactionProvenance({
    bundles: [
      { id: "b1", mode: "final", status: "succeeded", superseded_at: null, redactor_version: null },
      previewBundle({ id: "b2", superseded_at: "2026-08-01", redactor_version: "1.0.0" }),
      previewBundle({ id: "b3", status: "failed", redactor_version: "1.0.0" }),
    ],
  });
  assert.equal(f.filter((x) => x.severity === "critical").length, 0);
});

test("a future redactor version is accepted", () => {
  const f = auditPreviewRedactionProvenance({ bundles: [previewBundle({ redactor_version: "2.0.0" })] });
  assert.equal(f.filter((x) => x.severity === "critical").length, 0);
});

/**
 * Audit F-22. auditPreviewRedactionProvenance was implemented, unit-tested,
 * and accepted as an optional input by runSecurityAudit — but no caller ever
 * passed it. The check ran against its own fixtures and never against a real
 * bundle, so a preview artifact stamped by a pre-1.2.0 redactor (the version
 * that leaked precise borrower figures) would not have been reported by any
 * gate. These tests assert the wiring, not just the function.
 */
const AUDIT_INPUTS = {
  borrowerIsolation: {
    sessionA: { tokenHash: "a", dealId: "da" },
    sessionB: { tokenHash: "b", dealId: "db" },
    resolveSession: (h: string) => (h === "a" ? { deal_id: "da" } : h === "b" ? { deal_id: "db" } : null),
    resolveExpired: () => null,
  },
  lenderIsolation: { listings: [], claims: [], agreements: [], banks: [] },
  packageAccess: { accesses: [], claims: [], picks: [], listings: [] },
  redaction: { listings: [], deals: [] },
  adminPayloads: { payloads: [] },
  apiMethodSafety: { routes: [] },
  rateLimits: { specs: [] },
} as any;

test("[F-22] runSecurityAudit reports a stale-redactor preview bundle when fed one", () => {
  const result = m.runSecurityAudit({
    ...AUDIT_INPUTS,
    previewRedaction: {
      bundles: [
        { id: "b1", mode: "preview", status: "succeeded", superseded_at: null, redactor_version: "1.1.0" },
      ],
    },
  });
  const finding = result.findings.find((f) => f.check === "preview_stale_redactor_version");
  assert.ok(finding, "a pre-1.2.0 preview bundle must surface through the top-level audit");
  assert.equal(finding!.severity, "critical");
  assert.equal(result.ok, false);
});

test("[F-22] an unstamped preview bundle is reported as critical", () => {
  const result = m.runSecurityAudit({
    ...AUDIT_INPUTS,
    previewRedaction: {
      bundles: [
        { id: "b2", mode: "preview", status: "succeeded", superseded_at: null, redactor_version: null },
      ],
    },
  });
  assert.ok(result.findings.some((f) => f.check === "preview_missing_redactor_version"));
  assert.equal(result.ok, false);
});

test("[F-22] a current preview bundle passes", () => {
  const result = m.runSecurityAudit({
    ...AUDIT_INPUTS,
    previewRedaction: {
      bundles: [
        { id: "b3", mode: "preview", status: "succeeded", superseded_at: null, redactor_version: MIN_TRUSTED_REDACTOR_VERSION },
      ],
    },
  });
  assert.equal(result.findings.some((f) => f.severity === "critical"), false);
});

test("[F-22] the in-process gates pass preview bundles through to the audit", async () => {
  // The gates are the callers that were silently dropping this input.
  const readiness = require("../businessReadinessGate") as typeof import("../businessReadinessGate");
  const launch = require("../launchGate") as typeof import("../launchGate");
  const staleBundle = {
    id: "b4",
    mode: "preview",
    status: "succeeded",
    superseded_at: null,
    redactor_version: "1.0.0",
  };
  for (const [label, gate] of [
    ["businessReadinessGate", readiness.runSecurityGate],
    ["launchGate", launch.runSecurityGate],
  ] as const) {
    const clean = gate({ bundles: [] } as any);
    const dirty = gate({ bundles: [staleBundle] } as any);
    assert.ok(
      dirty.critical > clean.critical,
      `${label} must forward preview bundles into the security audit`,
    );
  }
});
