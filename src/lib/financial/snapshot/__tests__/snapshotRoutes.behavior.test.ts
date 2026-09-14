import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { FinancialSnapshotValidation } from "../getFinancialSnapshotGate";

const originals = new Map<string, NodeModule | undefined>();
function stub(name: string, exports: unknown) {
  const id = require.resolve(name);
  originals.set(id, require.cache[id]);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] } as unknown as NodeModule;
}
let allowed = true;
let computations = 0;
let computeResponse: Response;
let validation: FinancialSnapshotValidation;
let POST: typeof import("@/app/api/deals/[dealId]/financial-validation/rebuild/route").POST;
let GET: typeof import("@/app/api/deals/[dealId]/financial-validation/route").GET;
before(() => {
  stub("@/lib/auth/requireDealCockpitAccess", {
    COCKPIT_ROLES: ["banker"],
    requireDealCockpitAccess: async () => allowed ? { ok: true, bankId: "bank", userId: "banker" } : { ok: false, status: 403, error: "forbidden" },
  });
  stub("@/lib/pipeline/logLedgerEvent", { logLedgerEvent: async () => {} });
  stub("@/lib/deals/readiness", { recomputeDealReady: () => { throw new Error("readiness alone cannot rebuild snapshots"); } });
  stub("@/app/api/deals/[dealId]/financial-snapshot/recompute/route", {
    POST: async (_: Request, ctx: { params: Promise<{ dealId: string }> }) => {
      assert.equal((await ctx.params).dealId, "deal");
      computations++;
      return computeResponse;
    },
  });
  stub("@/lib/financial/snapshot/getFinancialSnapshotGate", {
    loadFinancialSnapshotValidation: async (dealId: string, options: unknown) => {
      assert.equal(dealId, "deal"); assert.deepEqual(options, { bankId: "bank" }); return validation;
    },
  });
  POST = require("@/app/api/deals/[dealId]/financial-validation/rebuild/route").POST;
  GET = require("@/app/api/deals/[dealId]/financial-validation/route").GET;
});
after(() => { for (const [id, original] of originals) { if (original) require.cache[id] = original; else delete require.cache[id]; } });
const ctx = () => ({ params: Promise.resolve({ dealId: "deal" }) });
const request = () => new NextRequest("http://localhost/api/deals/deal/financial-validation");

for (const status of [200, 409, 500]) test(`rebuild invokes computation once and propagates its ${status} response`, async () => {
  allowed = true; computations = 0;
  const payload = status === 200 ? { ok: true, snapshotId: "new-snapshot" } : { ok: false, error: "cannot_build_snapshot" };
  computeResponse = Response.json(payload, { status });
  const result = await POST(request(), ctx());
  assert.equal(computations, 1);
  assert.equal(result.status, status);
  assert.deepEqual(await result.json(), payload);
});
test("unauthorized rebuild never invokes computation", async () => {
  allowed = false; computations = 0;
  assert.equal((await POST(request(), ctx())).status, 403);
  assert.equal(computations, 0);
});
for (const ready of [true, false]) test(`validation API agrees with the shared committee gate: ${ready}`, async () => {
  allowed = true;
  validation = {
    snapshot: { id: "snapshot", created_at: "2026-09-11", snapshot_hash: "hash", snapshot_json: {} },
    completenessPercent: 100, missingRequiredKeys: [],
    gate: { evaluationStatus: "evaluated", ready, blockerCode: ready ? null : "financial_validation_open", message: ready ? null : "Conflict",
      evidence: { snapshotExists: true, snapshotAgeHours: 0, openReviewItems: ready ? 0 : 1, unresolvedConflicts: ready ? 0 : 1,
        unresolvedMissingFacts: 0, unresolvedLowConfidenceFacts: 0, lastBuiltAt: "2026-09-11", lastBuildStatus: "validated" } },
  };
  const response = await GET(request(), ctx());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.readiness.decisionSafe, ready);
  assert.equal(body.readiness.memoSafe, ready);
  assert.equal(body.gate.ready, ready);
  assert.equal(body.snapshot.status, ready ? "validated" : "needs_review");
});
test("validation API returns unavailable, not a fabricated empty success", async () => {
  allowed = true;
  validation = { snapshot: null, completenessPercent: null, missingRequiredKeys: [], gate: {
    evaluationStatus: "unavailable", ready: false, blockerCode: "financial_validation_unavailable", message: "Unavailable", evidence: null,
  } };
  const response = await GET(request(), ctx());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});
