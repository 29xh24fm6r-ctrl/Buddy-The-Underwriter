import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

// ─── Module shims: server-only + all transitive deps ──────────────────
mockServerOnly();
const require = createRequire(import.meta.url);
require.cache[require.resolve("workflow")] = {
  id: "workflow-stub",
  filename: "workflow-stub",
  loaded: true,
  exports: { FatalError: class FatalError extends Error {} },
} as any;

// ─── Mock state (shared by the stubs below) ────────────────────────────
type Row = Record<string, any>;

const state: {
  bundles: Row[];
  deals: Row[];
  sbaPackages: Row[];
  feasibilityStudies: Row[];
  memoNarratives: Row[];
  spreads: Row[];
  nextBundleId: () => string;
  sbaResult: any;
  feasResult: any;
  sbaPackageRowForXlsx: Row | null;
  enrichBusinessPlanPackageCalls: Array<{ dealId: string; bankId: string; packageId: string }>;
  enrichFeasibilityStudyCalls: Array<{ dealId: string; bankId: string; studyId: string }>;
} = {
  bundles: [],
  deals: [{ id: "deal-1", bank_id: "bank-1" }],
  sbaPackages: [],
  feasibilityStudies: [],
  memoNarratives: [],
  spreads: [],
  nextBundleId: (() => {
    let n = 0;
    return () => `bundle-${++n}`;
  })(),
  sbaResult: null,
  feasResult: null,
  sbaPackageRowForXlsx: null,
  enrichBusinessPlanPackageCalls: [],
  enrichFeasibilityStudyCalls: [],
};

function resetState() {
  state.bundles = [];
  state.sbaPackages = [];
  state.feasibilityStudies = [];
  state.memoNarratives = [{ id: "memo-1", deal_id: "deal-1", bank_id: "bank-1", input_hash: "memo-hash", research_trust_grade: "committee_grade" }];
  state.spreads = [{ id: "spread-1", deal_id: "deal-1", bank_id: "bank-1", spread_type: "CLASSIC_PDF", status: "ready", rendered_json: { pdf_sha256: "abc", canonicalFactsTimestamp: "2026-08-18T00:00:00Z" } }];
  state.enrichBusinessPlanPackageCalls = [];
  state.enrichFeasibilityStudyCalls = [];
  let n = 0;
  state.nextBundleId = () => `bundle-${++n}`;
  state.sbaResult = { ok: true, packageId: "pkg-1", pdfUrl: "sba-packages/deal-1/x.pdf", dscrBelowThreshold: false, dscrYear1Base: 1.4, versionNumber: 1, renderInput: {} };
  state.feasResult = { ok: true, studyId: "study-1", pdfUrl: "feas/deal-1/y.pdf", composite: {}, renderInput: {} };
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
    in(col: string, vals: any[]) {
      this._filters.push([col, "in", vals]);
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
        canonical_memo_narratives: state.memoNarratives,
        deal_spreads: state.spreads,
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
        this._filters.every(([col, op, val]: any) => op === "in" ? val.includes(row[col]) : row[col] === val),
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
  rpc(name: string, params: any) {
    if (name === "acquire_trident_bundle_run") {
      const id = state.nextBundleId();
      const lease = `lease-${id}`;
      state.bundles.push({
        id, deal_id: params.p_deal_id, bank_id: "bank-1", mode: params.p_mode,
        status: "pending", input_hash: params.p_input_hash,
        memo_input_hash: params.p_memo_input_hash, lease_token: lease,
        redactor_version: params.p_mode === "preview" ? "1.0.0" : null,
        superseded_at: null,
      });
      return Promise.resolve({ data: { bundle_id: id, reused: false, lease_token: lease }, error: null });
    }
    const row = state.bundles.find((b) => b.id === params.p_bundle_id && b.lease_token === params.p_lease_token);
    if (!row) return Promise.resolve({ data: null, error: { message: "trident lease lost" } });
    if (name === "record_trident_bundle_stage") {
      if (row.status === "pending") row.status = "running";
      row.current_stage = params.p_stage;
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "finalize_trident_bundle_run") {
      for (const prior of state.bundles) {
        if (prior.id !== row.id && prior.deal_id === row.deal_id && prior.mode === row.mode &&
            prior.status === "succeeded" && prior.superseded_at == null) prior.superseded_at = new Date().toISOString();
      }
      row.status = "succeeded";
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "fail_trident_bundle_run") {
      row.status = "failed";
      row.generation_error = params.p_error;
      row.generation_completed_at = new Date().toISOString();
      return Promise.resolve({ data: true, error: null });
    }
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

// Audit fix regression: enrichBusinessPlanPackage (SPEC-M8's verifier pass)
// is now called from generateTridentBundle.ts — stub it like the other
// downstream generators and record calls so the wiring itself is asserted,
// not just that the bundle still succeeds.
require.cache[require.resolve("@/lib/sba/enrichBusinessPlanPackage")] = {
  id: "enrich-business-plan-stub",
  filename: "enrich-business-plan-stub",
  loaded: true,
  exports: {
    enrichBusinessPlanPackage: async (args: { dealId: string; bankId: string; packageId: string; sb: unknown }) => {
      state.enrichBusinessPlanPackageCalls.push({ dealId: args.dealId, bankId: args.bankId, packageId: args.packageId });
      return { verdict: "pass", repaired: false };
    },
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

require.cache[require.resolve("@/lib/feasibility/enrichFeasibilityStudy")] = {
  id: "enrich-feasibility-stub",
  filename: "enrich-feasibility-stub",
  loaded: true,
  exports: {
    enrichFeasibilityStudy: async (args: { dealId: string; bankId: string; studyId: string }) => {
      state.enrichFeasibilityStudyCalls.push({ dealId: args.dealId, bankId: args.bankId, studyId: args.studyId });
      return { verdict: "pass", repaired: false };
    },
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

require.cache[require.resolve("@/lib/sba/sbaPackageRenderer")] = {
  id: "sba-render-stub",
  filename: "sba-render-stub",
  loaded: true,
  exports: { renderSBAPackagePDF: async () => Buffer.from("business-plan-pdf") },
} as any;

require.cache[require.resolve("@/lib/creditMemo/canonical/fetchMemoHashInputs")] = {
  id: "memo-hash-input-stub", filename: "memo-hash-input-stub", loaded: true,
  exports: { fetchMemoHashInputs: async () => ({}) },
} as any;
require.cache[require.resolve("@/lib/creditMemo/canonical/memoProvenance")] = {
  id: "memo-hash-stub", filename: "memo-hash-stub", loaded: true,
  exports: { computeMemoInputHash: () => "memo-hash" },
} as any;
require.cache[require.resolve("@/lib/creditMemo/canonical/generateCanonicalMemoArtifact")] = {
  id: "canonical-memo-stub", filename: "canonical-memo-stub", loaded: true,
  exports: {
    generateCanonicalMemoArtifact: async () => ({
      ok: true,
      narrativeId: "memo-1",
      memoId: "memo-1",
      inputHash: "memo-hash",
    }),
  },
} as any;
require.cache[require.resolve("@/lib/classicSpread/classicPdfWorker")] = {
  id: "classic-spread-stub", filename: "classic-spread-stub", loaded: true,
  exports: {
    renderClassicPdfSpread: async () => ({
      ok: true,
      spreadId: "spread-1",
    }),
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
  assert.equal(state.enrichBusinessPlanPackageCalls.length, 1, "verification must run on preview generation too");
});

test("final happy path: redactor_version null, projections XLSX populated", async () => {
  resetState();
  const substantive = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
  state.sbaPackages.push({
    id: "pkg-1",
    ...state.sbaPackageRowForXlsx,
    business_overview_narrative: substantive,
    executive_summary: substantive,
    industry_analysis: substantive,
    marketing_strategy: substantive,
    operations_plan: substantive,
    swot_strengths: substantive,
    swot_weaknesses: substantive,
    swot_opportunities: substantive,
    swot_threats: substantive,
    sensitivity_narrative: substantive,
    projections_assumptions_narrative: substantive,
    sources_and_uses: { balanced: true, imbalance: 0 },
    verification_verdict: "pass",
  });
  state.feasibilityStudies.push({
    id: "study-1",
    narratives: {
      executiveSummary: substantive,
      marketDemandNarrative: substantive,
      financialViabilityNarrative: substantive,
      operationalReadinessNarrative: substantive,
      locationSuitabilityNarrative: substantive,
    },
    verification_verdict: "pass",
    data_completeness: 0.9,
    narrative_citations: {
      market: { precise: true, urls: ["https://example.com/market"] },
      industry: { precise: true, urls: ["https://example.com/industry"] },
      location: { precise: true, urls: ["https://example.com/location"] },
    },
  });

  const r = await generateTridentBundle({ dealId: "deal-1", mode: "final" });
  assert.equal(r.ok, true);
  const row = state.bundles[0];
  assert.equal(row.status, "succeeded");
  assert.equal(row.redactor_version, null);
  assert.ok(row.projections_xlsx_path);
  assert.ok(row.projections_xlsx_path.endsWith("_projections.xlsx"));

  // Audit fix regression: business-plan verification must run on this path
  // (marketplace-pick final-mode generation) — previously it never did.
  assert.equal(state.enrichBusinessPlanPackageCalls.length, 1);
  const call = state.enrichBusinessPlanPackageCalls[0];
  assert.equal(call.dealId, "deal-1");
  assert.equal(call.bankId, "bank-1");
  assert.equal(call.packageId, "pkg-1");
  assert.deepEqual(state.enrichFeasibilityStudyCalls, [
    { dealId: "deal-1", bankId: "bank-1", studyId: "study-1" },
  ]);
});

test("final generation fails closed when business-plan PDF would contain placeholders", async () => {
  resetState();
  state.sbaPackages.push({
    id: "pkg-1",
    ...state.sbaPackageRowForXlsx,
    business_overview_narrative: "Business overview not available.",
    executive_summary: "Executive summary not available.",
  });

  const r = await generateTridentBundle({ dealId: "deal-1", mode: "final" });
  assert.equal(r.ok, false);
  assert.match(r.error, /Business-plan narrative acceptance failed: 0\/10/);
  assert.equal(state.bundles[0].status, "failed");
  assert.equal(state.bundles[0].business_plan_pdf_path, undefined);
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
  assert.equal(state.enrichBusinessPlanPackageCalls.length, 0, "must not run when the SBA package itself failed");
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
