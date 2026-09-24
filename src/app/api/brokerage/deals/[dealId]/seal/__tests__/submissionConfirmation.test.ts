import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let session: any;
let isolationError: Error | null;
let committed: any;
let gateCalls = 0;
let commitError = false;
const mockModule = (path: string, exports: any) => { require.cache[require.resolve(path)] = { exports } as any; };
const sb = {
  from: () => { const q: any = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: { spread_bps_over_prime: 275 }, error: null }) }; return q; },
  rpc: async (_name: string, args: any) => { committed = args; return { data: commitError ? [] : [{ sealed_package_id: "seal-1", listing_id: "listing-1" }], error: null }; },
};
mockModule("@/lib/supabase/admin", { supabaseAdmin: () => sb });
mockModule("@/lib/brokerage/sessionToken", { getBorrowerSession: async () => session });
const { DealIsolationError } = require("@/lib/qaIdentity/isolation");
mockModule("@/lib/qaIdentity/isolation", { DealIsolationError, assertNotTestDeal: async () => { if (isolationError) throw isolationError; } });
mockModule("@/lib/brokerage/sealingGate", { canSeal: async () => { gateCalls++; return { ok: true }; } });
const binding = { bundleId: "bundle-1", inputHash: "input-1", artifacts: { businessPlan: "plan.pdf", projectionsXlsx: "projection.xlsx", feasibility: "feas.pdf" } };
mockModule("@/lib/brokerage/buildSealedSnapshot", {
  buildSealedSnapshot: async () => ({ full: { tridentFinal: binding }, distributionBinding: binding, piiContext: {}, forRedactor: { deal: { loan_amount: 950000, term_months: 120, sba_program: "7a" }, score: { score: 78, band: "strong_fit", rateCardTier: "standard" } } }),
  sealedPackageArtifactColumns: () => ({ final_business_plan_path: "plan.pdf", final_projections_path: "projection.xlsx", final_feasibility_path: "feas.pdf" }),
  SealSnapshotError: class extends Error {},
});
mockModule("@/lib/brokerage/buildKFS", { buildKFS: async () => ({ redactionVersion: "1.1.0" }) });
mockModule("@/lib/brokerage/matchLenders", { matchLendersToDeal: async () => ({ matched: [], matchCount: 0, noMatchReasons: [] }) });
mockModule("@/lib/brokerage/hostileInterrogation", { runHostileInterrogationForDeal: async () => {} });
mockModule("@/lib/brokerage/lenderComms", { queueLenderMessage: async () => { throw new Error("No live messages allowed in test"); } });
const { POST } = require("../route");
const submit = (body: any) => POST({ json: async () => body }, { params: Promise.resolve({ dealId: "deal-1" }) });
test.beforeEach(() => { session = { deal_id: "deal-1", bank_id: "bank-1", claimed_email: "qa@example.invalid" }; isolationError = null; committed = null; gateCalls = 0; commitError = false; });

test("submission requires explicit, current sharing confirmation before any generation or write", async () => {
  for (const body of [null, {}, { sharingConfirmed: false }, { sharingConfirmed: "true" }, { sharingConfirmed: true, sharingConfirmationVersion: "obsolete" }]) {
    const res = await submit(body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "sharing_confirmation_required");
    assert.equal(gateCalls, 0);
    assert.equal(committed, null);
  }
});

test("confirmed submission stores the exact disclosure, server time, and immutable bundle binding", async () => {
  const res = await submit({ sharingConfirmed: true, sharingConfirmationVersion: "1.0.0" });
  assert.equal(res.status, 200);
  const proof = committed.p_sealed_snapshot.sharingConfirmation;
  assert.equal(proof.version, "1.0.0");
  assert.match(proof.statement, /submit it for lender matching/);
  assert.equal(proof.bundleId, "bundle-1");
  assert.equal(proof.inputHash, "input-1");
  assert.equal(proof.dealId, "deal-1");
  assert.ok(Number.isFinite(Date.parse(proof.confirmedAt)));
  assert.equal(proof.rawToken, undefined);
});

test("foreign sessions and unproven database transitions never report submission success", async () => {
  session.deal_id = "foreign";
  assert.equal((await submit({})).status, 404);
  assert.equal(committed, null);
  session.deal_id = "deal-1"; commitError = true;
  assert.equal((await submit({ sharingConfirmed: true, sharingConfirmationVersion: "1.0.0" })).status, 503);
});


test("confirmation cannot override QA isolation or unavailable isolation state", async () => {
  for (const [code, status] of [["test_application", 403], ["state_unavailable", 503]] as const) {
    isolationError = new DealIsolationError(code, "Test boundary");
    const res = await submit({ sharingConfirmed: true, sharingConfirmationVersion: "1.0.0" });
    assert.equal(res.status, status);
    assert.equal(gateCalls, 0);
    assert.equal(committed, null);
  }
});
