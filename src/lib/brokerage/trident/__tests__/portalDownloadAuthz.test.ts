import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

// Mock state
const state: {
  resolvedToken: { token: string; dealId: string } | null;
  bundles: any[];
  signedUrl: string | null;
} = {
  resolvedToken: null,
  bundles: [],
  signedUrl: "https://signed.example/path",
};

function reset() {
  state.resolvedToken = null;
  state.bundles = [];
  state.signedUrl = "https://signed.example/path";
}

require.cache[require.resolve("@/lib/brokerage/trident/portalTokenAuth")] = {
  id: "portal-token-stub",
  filename: "portal-token-stub",
  loaded: true,
  exports: {
    resolvePortalToken: async () => state.resolvedToken,
  },
} as any;

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-stub",
  filename: "supabase-stub",
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
          is(col: string) {
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
              if (!state.signedUrl) {
                return { data: null, error: { message: "boom" } };
              }
              return { data: { signedUrl: state.signedUrl }, error: null };
            },
          };
        },
      },
    }),
  },
} as any;

// Audit F-21: capture the audit writes this route now makes.
const auditWrites: any[] = [];
require.cache[require.resolve("@/lib/brokerage/packageDelivery")] = {
  id: "audit-stub",
  filename: "audit-stub",
  loaded: true,
  exports: {
    auditPackageDownload: async (entry: any) => {
      auditWrites.push(entry);
    },
  },
} as any;

const routeMod = require(
  "../../../../app/api/portal/[token]/trident/download/[kind]/route",
) as typeof import("../../../../app/api/portal/[token]/trident/download/[kind]/route");
const { GET } = routeMod;

function mkReq(): any {
  return { headers: new Map() };
}

async function call(token: string, kind: string) {
  const res = await GET(mkReq(), {
    params: Promise.resolve({ token, kind }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

test("portal download: missing/invalid token → 404", async () => {
  reset();
  state.resolvedToken = null;
  const { status } = await call("bad-token", "business-plan");
  assert.equal(status, 404);
});

test("portal download: invalid kind → 404 (no token leak)", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  const { status } = await call("t", "not-a-kind");
  assert.equal(status, 404);
});

test("portal download: valid token + valid kind + no bundle → 404", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  const { status } = await call("t", "business-plan");
  assert.equal(status, 404);
});

test("portal download: returns signed URL ONLY for preview bundle", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/preview/biz.pdf",
  });
  const { status, body } = await call("t", "business-plan");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, "preview");
  assert.ok(body.url);
});

test("portal download: NEVER serves a final bundle (preview-only contract)", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  // Only a final bundle exists for this deal — no preview row.
  state.bundles.push({
    deal_id: "deal-1",
    mode: "final",
    status: "succeeded",
    superseded_at: null,
    business_plan_pdf_path: "deal-1/final/biz.pdf",
  });
  const { status, body } = await call("t", "business-plan");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("portal download: bundle exists but artifact path missing → 404", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    superseded_at: null,
    feasibility_pdf_path: null, // requested kind has no path
  });
  const { status } = await call("t", "feasibility");
  assert.equal(status, 404);
});

test("portal download: kinds map dash-separated to underscore columns", async () => {
  reset();
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.bundles.push({
    deal_id: "deal-1",
    mode: "preview",
    status: "succeeded",
    superseded_at: null,
    projections_pdf_path: "deal-1/preview/proj.pdf",
  });
  const { status, body } = await call("t", "projections");
  assert.equal(status, 200);
  assert.ok(body.url);
});


/**
 * Audit F-21. The three Golden Trident artifacts are the deliverable, and
 * this route served them with no marketplace_audit_log entry at all — while
 * the cookie-scoped route recorded credit-memo and SBA-forms pulls. A
 * borrower-portal artifact pull left no trace of what was taken or when.
 */
test("[F-21] a served artifact is recorded in the download audit log", async () => {
  auditWrites.length = 0;
  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.signedUrl = "https://signed.example/bp.pdf";
  state.bundles = [
    {
      deal_id: "deal-1",
      mode: "preview",
      status: "succeeded",
      superseded_at: null,
      business_plan_pdf_path: "deal-1/preview/bp.pdf",
    },
  ];
  const { status } = await call("t", "business-plan");
  assert.equal(status, 200);
  assert.equal(auditWrites.length, 1, "serving an artifact must write one audit entry");
  const entry = auditWrites[0];
  assert.equal(entry.dealId, "deal-1");
  assert.equal(entry.action, "package_download");
  assert.equal(entry.actorScope, "borrower");
  assert.equal(entry.resourceType, "trident_business_plan");
  assert.equal(entry.metadata.mode, "preview");
});

test("[F-21] every artifact kind is audited under its own resource type", async () => {
  for (const [kind, column, resourceType] of [
    ["business-plan", "business_plan_pdf_path", "trident_business_plan"],
    ["projections", "projections_pdf_path", "trident_projections"],
    ["feasibility", "feasibility_pdf_path", "trident_feasibility"],
  ] as const) {
    auditWrites.length = 0;
    state.resolvedToken = { token: "t", dealId: "deal-1" };
    state.signedUrl = "https://signed.example/a.pdf";
    state.bundles = [
      {
        deal_id: "deal-1",
        mode: "preview",
        status: "succeeded",
        superseded_at: null,
        [column]: `deal-1/preview/a.pdf`,
      },
    ];
    const { status } = await call("t", kind);
    assert.equal(status, 200, `${kind} must be served`);
    assert.equal(auditWrites.length, 1, `${kind} must be audited`);
    assert.equal(auditWrites[0].resourceType, resourceType);
  }
});

test("[F-21] a refused download writes no audit entry", async () => {
  // The log records what was actually handed over, not what was attempted.
  auditWrites.length = 0;
  state.resolvedToken = null;
  await call("bad-token", "business-plan");
  assert.equal(auditWrites.length, 0);

  state.resolvedToken = { token: "t", dealId: "deal-1" };
  state.bundles = [];
  await call("t", "business-plan");
  assert.equal(auditWrites.length, 0, "a 404 is not a download");
});
