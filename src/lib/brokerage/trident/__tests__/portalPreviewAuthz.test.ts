import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const state: {
  resolvedToken: { token: string; dealId: string } | null;
  ensureResult: any;
  generateResult: any;
  generateCalls: { dealId: string; mode: string }[];
  bundleRow: any;
} = {
  resolvedToken: null,
  ensureResult: { ok: true, assumptionsId: "asm-1", alreadyConfirmed: false },
  generateResult: {
    ok: true,
    bundleId: "bundle-1",
    mode: "preview",
    paths: {
      businessPlanPdf: "deal-1/preview/biz.pdf",
      projectionsPdf: "deal-1/preview/proj.pdf",
      projectionsXlsx: null,
      feasibilityPdf: "deal-1/preview/feas.pdf",
    },
  },
  generateCalls: [],
  bundleRow: {
    id: "bundle-1",
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    version: 1,
    business_plan_pdf_path: "deal-1/preview/biz.pdf",
    projections_pdf_path: "deal-1/preview/proj.pdf",
    projections_xlsx_path: null,
    feasibility_pdf_path: "deal-1/preview/feas.pdf",
    generation_error: null,
    generated_at: "2026-05-03T00:00:00Z",
  },
};

function reset() {
  state.resolvedToken = null;
  state.ensureResult = {
    ok: true,
    assumptionsId: "asm-1",
    alreadyConfirmed: false,
  };
  state.generateResult = {
    ok: true,
    bundleId: "bundle-1",
    mode: "preview",
    paths: {
      businessPlanPdf: "deal-1/preview/biz.pdf",
      projectionsPdf: "deal-1/preview/proj.pdf",
      projectionsXlsx: null,
      feasibilityPdf: "deal-1/preview/feas.pdf",
    },
  };
  state.generateCalls = [];
  state.bundleRow = {
    id: "bundle-1",
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    version: 1,
    business_plan_pdf_path: "deal-1/preview/biz.pdf",
    projections_pdf_path: "deal-1/preview/proj.pdf",
    projections_xlsx_path: null,
    feasibility_pdf_path: "deal-1/preview/feas.pdf",
    generation_error: null,
    generated_at: "2026-05-03T00:00:00Z",
  };
}

require.cache[require.resolve("@/lib/brokerage/trident/portalTokenAuth")] = {
  id: "ptoken-stub",
  filename: "ptoken-stub",
  loaded: true,
  exports: {
    resolvePortalToken: async () => state.resolvedToken,
  },
} as any;

require.cache[
  require.resolve("@/lib/sba/sbaAssumptionsBootstrap")
] = {
  id: "ensure-stub",
  filename: "ensure-stub",
  loaded: true,
  exports: {
    ensureAssumptionsForPreview: async () => state.ensureResult,
  },
} as any;

require.cache[
  require.resolve("@/lib/brokerage/trident/generateTridentBundle")
] = {
  id: "gen-stub",
  filename: "gen-stub",
  loaded: true,
  exports: {
    generateTridentBundle: async (a: { dealId: string; mode: string }) => {
      state.generateCalls.push(a);
      return state.generateResult;
    },
  },
} as any;

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-stub",
  filename: "supabase-stub",
  loaded: true,
  exports: {
    supabaseAdmin: () => ({
      from(table: string) {
        const q: any = {
          _filters: {} as Record<string, any>,
          select() {
            return this;
          },
          eq(k: string, v: any) {
            this._filters[k] = v;
            return this;
          },
          maybeSingle() {
            if (table === "borrower_concierge_sessions") {
              return Promise.resolve({
                data: { extracted_facts: { borrower: { first_name: "X" } } },
                error: null,
              });
            }
            if (table === "buddy_trident_bundles") {
              return Promise.resolve({ data: state.bundleRow, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return q;
      },
    }),
  },
} as any;

const routeMod = require(
  "../../../../app/api/portal/[token]/trident/preview/route",
) as typeof import("../../../../app/api/portal/[token]/trident/preview/route");
const { POST } = routeMod;

function mkReq(): any {
  return { headers: new Map() };
}
async function call(token: string) {
  const res = await POST(mkReq(), {
    params: Promise.resolve({ token }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

test("portal preview: missing/invalid token → 404 + never calls generator", async () => {
  reset();
  state.resolvedToken = null;
  const { status } = await call("bad");
  assert.equal(status, 404);
  assert.equal(state.generateCalls.length, 0);
});

test("portal preview: assumptions blocked → missing_prerequisites + gaps + no generation", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.ensureResult = {
    ok: false,
    blockers: ["At least one revenue stream is required", "Loan amount is required"],
  };
  const { status, body } = await call("t");
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, "missing_prerequisites");
  assert.deepEqual(body.gaps, [
    "At least one revenue stream is required",
    "Loan amount is required",
  ]);
  assert.equal(state.generateCalls.length, 0);
});

test("portal preview: happy path → generator called with mode=preview, ok bundle returned", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  const { status, body } = await call("t");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(state.generateCalls.length, 1);
  assert.equal(state.generateCalls[0].mode, "preview");
  assert.equal(body.bundle.id, "bundle-1");
  assert.equal(body.bundle.mode, "preview");
  assert.equal(body.bundle.status, "succeeded");
  assert.equal(body.bundle.businessPlanPdfPath, "deal-1/preview/biz.pdf");
  assert.equal(body.bundle.projectionsPdfPath, "deal-1/preview/proj.pdf");
  assert.equal(body.bundle.feasibilityPdfPath, "deal-1/preview/feas.pdf");
});

test("portal preview: generator failure surfaces bundle in failed state", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.generateResult = {
    ok: false,
    bundleId: "bundle-1",
    error: "feasibility renderer crashed",
  };
  state.bundleRow = {
    ...state.bundleRow,
    status: "failed",
    generation_error: "feasibility renderer crashed",
  };
  const { status, body } = await call("t");
  assert.equal(status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, "generation_failed");
  assert.equal(body.bundle.status, "failed");
  assert.equal(body.bundle.generationError, "feasibility renderer crashed");
});

test("portal preview: NEVER allows mode=final via this surface", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  await call("t");
  assert.equal(state.generateCalls[0].mode, "preview");
});
