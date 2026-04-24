import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// ─── Module shims: server-only + all transitive deps ──────────────────
const require = createRequire(import.meta.url);
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "server-only") {
    return path.join(process.cwd(), "node_modules/server-only/empty.js");
  }
  return origResolve.call(this, request, ...args);
};

// ─── Mock state (shared by the stubs below) ────────────────────────────
type Row = Record<string, any>;

const state: {
  bundles: Row[];
  deals: Row[];
  sbaPackages: Row[];
  feasibilityStudies: Row[];
  nextBundleId: () => string;
  sbaResult: any;
  feasResult: any;
  sbaPackageRowForXlsx: Row | null;
} = {
  bundles: [],
  deals: [{ id: "deal-1", bank_id: "bank-1" }],
  sbaPackages: [],
  feasibilityStudies: [],
  nextBundleId: (() => {
    let n = 0;
    return () => `bundle-${++n}`;
  })(),
  sbaResult: null,
  feasResult: null,
  sbaPackageRowForXlsx: null,
};

function resetState() {
  state.bundles = [];
  state.sbaPackages = [];
  state.feasibilityStudies = [];
  let n = 0;
  state.nextBundleId = () => `bundle-${++n}`;
  state.sbaResult = { ok: true, packageId: "pkg-1", pdfUrl: "sba-packages/deal-1/x.pdf", dscrBelowThreshold: false, dscrYear1Base: 1.4, versionNumber: 1 };
  state.feasResult = { ok: true, studyId: "study-1", pdfUrl: "feas/deal-1/y.pdf", composite: {} };
  state.sbaPackageRowForXlsx = {
    base_year_data: {},
    projections_annual: [],
    projections_monthly: [],
    sensitivity_scenarios: [],
    sources_and_uses: {},
    balance_sheet_projections: {},
  };
}
resetState();

// ─── Supabase client stub ──────────────────────────────────────────────

function makeQueryBuilder(table: string) {
  const q: any = {
    _table: table,
    _filters: [] as Array<[string, string, any]>,
    _isNull: [] as string[],
    _notEq: null as [string, any] | null,
    _select: null as string | null,
    _orderBy: null as string | null,
    _limit: null as number | null,
    _selectAfterUpdate: false,
    _payload: null as any,
    _updatePayload: null as any,
    _insertPayload: null as any,
    _op: "select" as "select" | "insert" | "update" | "delete",
    select(s: string) {
      this._select = s;
      return this;
    },
    insert(payload: any) {
      this._op = "insert";
      this._insertPayload = payload;
      return this;
    },
    update(payload: any) {
      this._op = "update";
      this._updatePayload = payload;
      return this;
    },
    eq(col: string, val: any) {
      this._filters.push([col, "eq", val]);
      return this;
    },
    is(col: string, _val: null) {
      this._isNull.push(col);
      return this;
    },
    neq(col: string, val: any) {
      this._notEq = [col, val];
      return this;
    },
    order(col: string) {
      this._orderBy = col;
      return this;
    },
    limit(n: number) {
      this._limit = n;
      return this;
    },
    maybeSingle() {
      const rows = this._exec();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    single() {
      const rows = this._exec();
      if (rows.length === 0) {
        return Promise.resolve({ data: null, error: { message: "Not found" } });
      }
      return Promise.resolve({ data: rows[0], error: null });
    },
    then(onFulfilled: any) {
      const rows = this._exec();
      return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
    },
    _exec(): Row[] {
      const source = ({
        buddy_trident_bundles: state.bundles,
        deals: state.deals,
        buddy_sba_packages: state.sbaPackages,
        buddy_feasibility_studies: state.feasibilityStudies,
      } as Record<string, Row[]>)[this._table];
      if (!source) return [];

      if (this._op === "insert") {
        const payloads = Array.isArray(this._insertPayload)
          ? this._insertPayload
          : [this._insertPayload];
        const inserted = payloads.map((p: any) => {
          const row: Row = { ...p };
          if (this._table === "buddy_trident_bundles") {
            row.id = state.nextBundleId();
            row.generated_at = new Date().toISOString();
            if (row.superseded_at === undefined) row.superseded_at = null;
          }
          if (this._table === "buddy_sba_packages") {
            row.id = `pkg-${source.length + 1}`;
          }
          source.push(row);
          return row;
        });
        return inserted;
      }

      let filtered = source.filter((row) =>
        this._filters.every(([col, _op, val]: any) => row[col] === val),
      );
      for (const col of this._isNull) {
        filtered = filtered.filter((row) => row[col] == null);
      }
      if (this._notEq) {
        const [col, val] = this._notEq;
        filtered = filtered.filter((row) => row[col] !== val);
      }

      if (this._op === "update") {
        for (const row of filtered) {
          Object.assign(row, this._updatePayload);
        }
        return filtered;
      }

      if (this._orderBy) {
        // Not strictly needed for our tests.
      }
      if (this._limit != null) {
        filtered = filtered.slice(0, this._limit);
      }
      return filtered;
    },
  };
  return q;
}

const supabaseStub = {
  from(table: string) {
    return makeQueryBuilder(table);
  },
  storage: {
    from(_bucket: string) {
      return {
        async download(_p: string) {
          return {
            data: {
              arrayBuffer: async () => Buffer.from("pdf-bytes").buffer,
            },
            error: null,
          };
        },
        async upload(_p: string, _b: any) {
          return { data: { path: _p }, error: null };
        },
        async createSignedUrl(_p: string, _ttl: number) {
          return { data: { signedUrl: "https://signed.example/" + _p }, error: null };
        },
      };
    },
  },
  rpc() {
    return Promise.resolve({ data: null, error: null });
  },
};

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: { supabaseAdmin: () => supabaseStub },
} as any;

// Stub the downstream generators so tests stay fast and deterministic.
require.cache[require.resolve("@/lib/sba/sbaPackageOrchestrator")] = {
  id: "sba-pkg-stub",
  filename: "sba-pkg-stub",
  loaded: true,
  exports: {
    generateSBAPackage: async () => state.sbaResult,
  },
} as any;

require.cache[require.resolve("@/lib/feasibility/feasibilityEngine")] = {
  id: "feas-eng-stub",
  filename: "feas-eng-stub",
  loaded: true,
  exports: {
    generateFeasibilityStudy: async () => state.feasResult,
  },
} as any;

require.cache[require.resolve("@/lib/feasibility/feasibilityRenderer")] = {
  id: "feas-render-stub",
  filename: "feas-render-stub",
  loaded: true,
  exports: {
    renderFeasibilityPDF: async () => Buffer.from("feasibility-pdf"),
  },
} as any;

// Load the orchestrator now that shims are in place.
const { generateTridentBundle } =
  require("../generateTridentBundle") as typeof import("../generateTridentBundle");

// ─── Tests ────────────────────────────────────────────────────────────

test("preview happy path: pending → running → succeeded with redactor_version set", async () => {
  resetState();
  // Seed a study row so the preview re-render path can find it.
  state.feasibilityStudies.push({ id: "study-1", composite_score: 73, narratives: { market_demand: "x" } });

  const r = await generateTridentBundle({ dealId: "deal-1", mode: "preview" });
  assert.equal(r.ok, true);
  assert.equal(state.bundles.length, 1);
  const row = state.bundles[0];
  assert.equal(row.status, "succeeded");
  assert.equal(row.mode, "preview");
  assert.equal(row.redactor_version, "1.0.0");
  assert.ok(row.business_plan_pdf_path);
  assert.equal(row.projections_xlsx_path, null); // preview = no XLSX
});

test("final happy path: redactor_version null, projections XLSX populated", async () => {
  resetState();
  state.sbaPackages.push({ id: "pkg-1", ...state.sbaPackageRowForXlsx });
  state.feasibilityStudies.push({ id: "study-1", narratives: {} });

  const r = await generateTridentBundle({ dealId: "deal-1", mode: "final" });
  assert.equal(r.ok, true);
  const row = state.bundles[0];
  assert.equal(row.status, "succeeded");
  assert.equal(row.redactor_version, null);
  assert.ok(row.projections_xlsx_path);
  assert.ok(row.projections_xlsx_path.endsWith("_projections.xlsx"));
});

test("SBA package failure: bundle marked failed with generation_error", async () => {
  resetState();
  state.sbaResult = { ok: false, error: "assumptions not confirmed" };
  const r = await generateTridentBundle({ dealId: "deal-1", mode: "preview" });
  assert.equal(r.ok, false);
  const row = state.bundles[0];
  assert.equal(row.status, "failed");
  assert.ok(row.generation_error?.includes("assumptions not confirmed"));
  assert.ok(row.generation_completed_at);
});

test("feasibility failure is non-fatal; bundle still succeeded, feasibility path null", async () => {
  resetState();
  state.feasResult = { ok: false, error: "BIE unavailable" };

  const r = await generateTridentBundle({ dealId: "deal-1", mode: "preview" });
  assert.equal(r.ok, true);
  const row = state.bundles[0];
  assert.equal(row.status, "succeeded");
  assert.equal(row.feasibility_pdf_path, null);
  assert.ok(row.business_plan_pdf_path);
});

test("new succeeded bundle supersedes prior succeeded for same (deal, mode)", async () => {
  resetState();
  state.feasibilityStudies.push({ id: "study-1", narratives: {} });

  await generateTridentBundle({ dealId: "deal-1", mode: "preview" });
  await generateTridentBundle({ dealId: "deal-1", mode: "preview" });

  const succeeded = state.bundles.filter((b) => b.status === "succeeded");
  assert.equal(succeeded.length, 2);
  const current = succeeded.filter((b) => b.superseded_at == null);
  assert.equal(current.length, 1, "exactly one non-superseded succeeded bundle per (deal, mode)");
});

test("failed bundle does NOT supersede prior succeeded", async () => {
  resetState();
  state.feasibilityStudies.push({ id: "study-1", narratives: {} });
  await generateTridentBundle({ dealId: "deal-1", mode: "preview" });
  assert.equal(state.bundles[0].status, "succeeded");

  state.sbaResult = { ok: false, error: "boom" };
  await generateTridentBundle({ dealId: "deal-1", mode: "preview" });

  const succeeded = state.bundles.filter((b) => b.status === "succeeded" && b.superseded_at == null);
  assert.equal(succeeded.length, 1, "prior succeeded bundle remains current");
  const failed = state.bundles.filter((b) => b.status === "failed");
  assert.equal(failed.length, 1);
});
