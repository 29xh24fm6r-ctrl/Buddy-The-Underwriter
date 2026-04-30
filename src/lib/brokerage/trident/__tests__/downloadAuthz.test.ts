import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

// ─── Mock state ────────────────────────────────────────────────────────
const state: {
  session: any;
  bundles: any[];
  signedUrlReturns: { signedUrl?: string; error?: any };
} = {
  session: null,
  bundles: [],
  signedUrlReturns: { signedUrl: "https://signed.example/path" },
};

function resetState() {
  state.session = null;
  state.bundles = [];
  state.signedUrlReturns = { signedUrl: "https://signed.example/path" };
}

// Stub next/server with a minimal NextResponse/NextRequest shim.
// The route imports these from "next/server"; we let the real module load
// but we don't use its runtime behavior — only .json() via a plain Response.

// Stub getBorrowerSession.
require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session-stub",
  filename: "session-stub",
  loaded: true,
  exports: {
    getBorrowerSession: async () => state.session,
  },
} as any;

// Stub supabaseAdmin with a query builder that serves state.bundles.
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "admin-stub",
  filename: "admin-stub",
  loaded: true,
  exports: {
    supabaseAdmin: () => ({
      from(_table: string) {
        const q: any = {
          _filters: {} as Record<string, any>,
          _isNull: [] as string[],
          select() {
            return this;
          },
          eq(k: string, v: any) {
            this._filters[k] = v;
            return this;
          },
          is(col: string, _v: null) {
            this._isNull.push(col);
            return this;
          },
          maybeSingle() {
            const match = state.bundles.find(
              (b) =>
                Object.entries(this._filters).every(([k, v]) => b[k] === v) &&
                this._isNull.every((col: string) => b[col] == null),
            );
            return Promise.resolve({ data: match ?? null, error: null });
          },
        };
        return q;
      },
      storage: {
        from(_b: string) {
          return {
            async createSignedUrl(_p: string, _ttl: number) {
              if (state.signedUrlReturns.error) {
                return { data: null, error: state.signedUrlReturns.error };
              }
              return {
                data: { signedUrl: state.signedUrlReturns.signedUrl },
                error: null,
              };
            },
          };
        },
      },
    }),
  },
} as any;

// Load the route handler.
const routeModule = require(
  "../../../../app/api/brokerage/deals/[dealId]/trident/download/[kind]/route",
) as typeof import("../../../../app/api/brokerage/deals/[dealId]/trident/download/[kind]/route");
const { GET } = routeModule;

function mkReq(): any {
  return { headers: new Map() };
}
async function call(dealId: string, kind: string) {
  const res = await GET(mkReq(), {
    params: Promise.resolve({ dealId, kind }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────────

test("no cookie → 404", async () => {
  resetState();
  state.session = null;
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("cookie present but deal_id mismatches URL → 404 (never 403)", async () => {
  resetState();
  state.session = { deal_id: "deal-OTHER", tokenHash: "h" };
  const { status } = await call("deal-1", "business_plan");
  assert.equal(status, 404);
});

test("invalid kind → 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  const { status } = await call("deal-1", "not_a_kind");
  assert.equal(status, 404);
});

test("cookie + matching deal but no current bundle → 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  const { status } = await call("deal-1", "business_plan");
  assert.equal(status, 404);
});

test("cookie + matching deal + current final bundle → 200 with signed URL", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/final/1_business_plan.pdf",
  });
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.url);
  assert.equal(body.mode, "final");
});

test("cookie + matching deal + only preview bundle → 200 with preview URL", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/preview/1_business_plan.pdf",
  });
  const { status, body } = await call("deal-1", "business_plan");
  assert.equal(status, 200);
  assert.equal(body.mode, "preview");
});

test("bundle exists but artifact path missing → 404", async () => {
  resetState();
  state.session = { deal_id: "deal-1", tokenHash: "h" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "path.pdf",
    projections_xlsx_path: null, // asking for XLSX — not present
  });
  const { status } = await call("deal-1", "projections_xlsx");
  assert.equal(status, 404);
});
