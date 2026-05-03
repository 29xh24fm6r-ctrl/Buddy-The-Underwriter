import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const state: {
  session: any;
  generateCalls: { dealId: string; mode: string }[];
  generateReturn: any;
} = {
  session: null,
  generateCalls: [],
  generateReturn: {
    ok: true,
    bundleId: "bundle-1",
    mode: "preview",
    paths: {
      businessPlanPdf: "deal-1/preview/x_business_plan.pdf",
      projectionsPdf: null,
      projectionsXlsx: null,
      feasibilityPdf: "deal-1/preview/x_feasibility.pdf",
    },
  },
};

function reset() {
  state.session = null;
  state.generateCalls = [];
  state.generateReturn = {
    ok: true,
    bundleId: "bundle-1",
    mode: "preview",
    paths: {
      businessPlanPdf: "deal-1/preview/x_business_plan.pdf",
      projectionsPdf: null,
      projectionsXlsx: null,
      feasibilityPdf: "deal-1/preview/x_feasibility.pdf",
    },
  };
}

require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session-stub",
  filename: "session-stub",
  loaded: true,
  exports: {
    getBorrowerSession: async () => state.session,
  },
} as any;

require.cache[
  require.resolve("@/lib/brokerage/trident/generateTridentBundle")
] = {
  id: "gen-stub",
  filename: "gen-stub",
  loaded: true,
  exports: {
    generateTridentBundle: async (args: { dealId: string; mode: string }) => {
      state.generateCalls.push(args);
      return state.generateReturn;
    },
  },
} as any;

const routeModule = require(
  "../../../../app/api/brokerage/deals/[dealId]/trident/preview/route",
) as typeof import("../../../../app/api/brokerage/deals/[dealId]/trident/preview/route");
const { POST } = routeModule;

function mkReq(): any {
  return { headers: new Map() };
}
async function call(dealId: string) {
  const res = await POST(mkReq(), {
    params: Promise.resolve({ dealId }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

test("no cookie → 404 and never calls generator", async () => {
  reset();
  state.session = null;
  const { status } = await call("deal-1");
  assert.equal(status, 404);
  assert.equal(state.generateCalls.length, 0);
});

test("cookie deal mismatches URL → 404 and never calls generator", async () => {
  reset();
  state.session = { deal_id: "deal-OTHER", tokenHash: "h" };
  const { status } = await call("deal-1");
  assert.equal(status, 404);
  assert.equal(state.generateCalls.length, 0);
});

test("cookie matches → generator called with mode=preview", async () => {
  reset();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  const { status, body } = await call("deal-1");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, "preview");
  assert.equal(state.generateCalls.length, 1);
  assert.deepEqual(state.generateCalls[0], {
    dealId: "deal-1",
    mode: "preview",
  });
});

test("preview route NEVER lets caller request mode=final", async () => {
  reset();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  await call("deal-1");
  assert.equal(state.generateCalls[0].mode, "preview");
});

test("generator failure surfaces as 500 with error", async () => {
  reset();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.generateReturn = {
    ok: false,
    bundleId: null,
    error: "boom",
  };
  const { status, body } = await call("deal-1");
  assert.equal(status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.error, "boom");
});
