import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { projectionFixture } from "../../sba/__tests__/projectionLedger.fixture";
mockServerOnly();
const require = createRequire(import.meta.url);
const stub = (path: string, exports: unknown) => { require.cache[require.resolve(path)] = { exports, loaded: true } as any; };
let authorized = true;
let basisReads = 0;
let modelCalls = 0;
let aiCalls = 0;
stub("../../borrower/resolvePortalContext", { resolvePortalContext: async () => {
  if (!authorized) throw new Error("invalid token");
  return { dealId: "deal-1", bankId: "bank-1" };
} });
stub("../packageProjectionBasis", { loadPackageProjectionBasis: async (dealId: string, bankId: string) => {
  basisReads++; assert.equal(dealId, "deal-1"); assert.equal(bankId, "bank-1");
  const fixture = projectionFixture();
  return { baseYear: fixture.baseYear, bsBase: fixture.openingBalance, useOfProceeds: fixture.useOfProceeds,
    preOpening: true, authority: { facts: [] }, deal: { deal_type: "SBA", loan_amount: 950000 } };
} });
stub("../../supabase/admin", { supabaseAdmin: () => ({ from: (table: string) => {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: null,
    data: table === "deals" ? { id: "deal-1", bank_id: "bank-1", name: "QA", loan_amount: 950000 } : { deal_id: "deal-1", status: "confirmed" } }) };
  return q;
} }) });
stub("../packageFinancialComputation", { computePackageFinancialOutput: async (dealId: string, bankId: string) => {
  modelCalls++; assert.equal(dealId, "deal-1"); assert.equal(bankId, "bank-1");
  throw new Error("financial_input_required: Projection reconciliation blocked");
} });
stub("../../sba/sbaActionableRoadmap", { generateActionableRoadmap: async () => { aiCalls++; throw new Error("AI must not run"); } });
const { GET } = require("../../../app/api/borrower/portal/[token]/base-year/route") as typeof import("../../../app/api/borrower/portal/[token]/base-year/route");
const { POST } = require("../../../app/api/borrower/portal/[token]/generate-pdf/route") as typeof import("../../../app/api/borrower/portal/[token]/generate-pdf/route");
const context = { params: Promise.resolve({ token: "qa-token" }) };
test.afterEach(() => { authorized = true; basisReads = 0; modelCalls = 0; aiCalls = 0; });

test("interview receives the package's startup opening balance and funding costs without raw financial facts", async () => {
  const res = await GET(new NextRequest("http://localhost/base-year"), context);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control")!, /private, no-store/);
  const body = await res.json();
  assert.equal(body.projectionBasis.baseYear.label, "Pre-opening");
  assert.equal(body.projectionBasis.openingBalance.cash, 250000);
  assert.equal(body.projectionBasis.useOfProceeds.length, 5);
  assert.equal(body.authority, undefined);
  assert.equal(basisReads, 1);
});

test("unauthorized projection requests cannot load financial inputs", async () => {
  authorized = false;
  assert.equal((await GET(new NextRequest("http://localhost/base-year"), context)).status, 401);
  assert.equal((await POST(new NextRequest("http://localhost/generate-pdf", { method: "POST" }), context)).status, 401);
  assert.equal(basisReads + modelCalls + aiCalls, 0);
});

test("borrower PDF rejects an unreconciled model before roadmap AI or file delivery", async () => {
  const res = await POST(new NextRequest("http://localhost/generate-pdf", { method: "POST" }), context);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "financial_facts_unavailable");
  assert.equal(body.pdfUrl, undefined);
  assert.equal(modelCalls, 1);
  assert.equal(aiCalls, 0);
});
