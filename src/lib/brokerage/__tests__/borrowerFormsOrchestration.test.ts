import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const {
  resolveSbaPackageTemplate,
  prepareBrokerageSbaForms,
  getBrokerageFormsStatus,
  generateBrokerageForms,
  assembleBrokerageFormsPackage,
} = require("../borrowerFormsOrchestration") as typeof import("../borrowerFormsOrchestration");

test("resolveSbaPackageTemplate: SBA_504 maps to the 504 package", () => {
  assert.deepEqual(resolveSbaPackageTemplate("SBA_504"), {
    packageTemplateCode: "SBA_504_BASE",
    product: "504",
  });
});

test("resolveSbaPackageTemplate: SBA_7A, SBA_EXPRESS, null, and unknown all default to 7a", () => {
  for (const productType of ["SBA_7A", "SBA_EXPRESS", null, undefined, "TERM_LOAN"]) {
    assert.deepEqual(resolveSbaPackageTemplate(productType as any), {
      packageTemplateCode: "SBA_7A_BASE",
      product: "7a",
    });
  }
});

// ── In-memory Supabase-ish stub ─────────────────────────────────────────
type Row = Record<string, any>;

function makeSb(state: {
  deal?: Row | null;
  packageRuns?: Row[];
  packageRunItems?: Row[];
}) {
  const deal = state.deal ?? null;
  const packageRuns = state.packageRuns ?? [];
  const packageRunItems = state.packageRunItems ?? [];

  return {
    from(table: string) {
      const q: any = {
        _filters: {} as Record<string, any>,
        _insertedRows: null as Row[] | null,
        select() {
          return this;
        },
        eq(k: string, v: any) {
          this._filters[k] = v;
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        insert(rows: Row | Row[]) {
          this._insertedRows = Array.isArray(rows) ? rows : [rows];
          return this;
        },
        update(patch: Row) {
          this._updatePatch = patch;
          return this;
        },
        maybeSingle() {
          if (table === "deals") return Promise.resolve({ data: deal, error: null });
          if (table === "sba_package_runs") {
            if (this._insertedRows) {
              const row = { id: "run-new", deal_id: this._insertedRows[0].deal_id, status: "prepared" };
              packageRuns.push(row);
              return Promise.resolve({ data: [{ id: row.id }], error: null });
            }
            const matches = packageRuns
              .filter((r) => !this._filters.deal_id || r.deal_id === this._filters.deal_id)
              .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
            return Promise.resolve({ data: matches[0] ?? null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          return this.maybeSingle();
        },
        then(resolve: (r: { data: any; error: null; count?: number }) => void) {
          if (table === "sba_package_run_items") {
            if (this._insertedRows) {
              packageRunItems.push(...this._insertedRows);
              resolve({ data: this._insertedRows, error: null });
              return;
            }
            if (this._updatePatch) {
              const item = packageRunItems.find((it) => it.id === this._filters.id);
              if (item) Object.assign(item, this._updatePatch);
              resolve({ data: null, error: null });
              return;
            }
            const matches = packageRunItems.filter((it) => it.package_run_id === this._filters.package_run_id);
            resolve({ data: matches, error: null, count: matches.length });
            return;
          }
          if (table === "sba_package_runs" && this._updatePatch) {
            const run = packageRuns.find((r) => r.id === this._filters.id);
            if (run) Object.assign(run, this._updatePatch);
            resolve({ data: null, error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return q;
    },
    storage: {
      from() {
        return {
          upload: async () => ({ error: null }),
        };
      },
    },
  } as any;
}

test("prepareBrokerageSbaForms: returns DEAL_NOT_FOUND when the deal doesn't exist", async () => {
  const sb = makeSb({ deal: null });
  const result = await prepareBrokerageSbaForms("deal-1", sb);
  assert.deepEqual(result, { ok: false, reason: "DEAL_NOT_FOUND" });
});

test("prepareBrokerageSbaForms: reuses an existing package run instead of creating a second one", async () => {
  const sb = makeSb({
    deal: { product_type: "SBA_7A" },
    packageRuns: [{ id: "run-existing", deal_id: "deal-1", status: "generated", created_at: "2026-01-01" }],
    packageRunItems: [
      { id: "item-1", package_run_id: "run-existing" },
      { id: "item-2", package_run_id: "run-existing" },
    ],
  });
  const result = await prepareBrokerageSbaForms("deal-1", sb);
  assert.deepEqual(result, { ok: true, packageRunId: "run-existing", itemCount: 2, reused: true });
});

test("getBrokerageFormsStatus: NO_PACKAGE_RUN when nothing has been prepared yet", async () => {
  const sb = makeSb({ packageRuns: [] });
  const result = await getBrokerageFormsStatus("deal-1", sb);
  assert.deepEqual(result, { ok: false, reason: "NO_PACKAGE_RUN" });
});

test("getBrokerageFormsStatus: returns the package run plus its items", async () => {
  const sb = makeSb({
    packageRuns: [{ id: "run-1", deal_id: "deal-1", status: "prepared", created_at: "2026-01-01" }],
    packageRunItems: [
      {
        id: "item-1",
        package_run_id: "run-1",
        template_code: "SBA_1919",
        title: "SBA Form 1919",
        required: true,
        status: "prepared",
        fill_run_id: "fill-1",
        output_storage_path: null,
        error: null,
      },
    ],
  });
  const result = await getBrokerageFormsStatus("deal-1", sb);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.packageRun?.id, "run-1");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].templateCode, "SBA_1919");
  }
});

test("generateBrokerageForms: NO_PACKAGE_RUN when nothing has been prepared yet", async () => {
  const sb = makeSb({ packageRuns: [] });
  const result = await generateBrokerageForms("deal-1", sb);
  assert.deepEqual(result, { ok: false, reason: "NO_PACKAGE_RUN" });
});

test("generateBrokerageForms: ITEM_NOT_FOUND when onlyItemId doesn't belong to the deal's run", async () => {
  const sb = makeSb({
    packageRuns: [{ id: "run-1", deal_id: "deal-1", status: "prepared", created_at: "2026-01-01" }],
    packageRunItems: [{ id: "item-1", package_run_id: "run-1", fill_run_id: "fill-1", template_code: "SBA_1919" }],
  });
  const result = await generateBrokerageForms("deal-1", sb, { onlyItemId: "item-from-another-deal" });
  assert.deepEqual(result, { ok: false, reason: "ITEM_NOT_FOUND" });
});

test("generateBrokerageForms: an item with no fill_run_id fails gracefully instead of throwing", async () => {
  const sb = makeSb({
    packageRuns: [{ id: "run-1", deal_id: "deal-1", status: "prepared", created_at: "2026-01-01" }],
    packageRunItems: [{ id: "item-1", package_run_id: "run-1", fill_run_id: null, template_code: "SBA_1919" }],
  });
  const result = await generateBrokerageForms("deal-1", sb);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error, "Missing fill_run_id");
  }
});

test("assembleBrokerageFormsPackage: NO_PACKAGE_RUN when nothing has been prepared yet", async () => {
  const sb = makeSb({ packageRuns: [] });
  const result = await assembleBrokerageFormsPackage("deal-1", sb);
  assert.deepEqual(result, { ok: false, reason: "NO_PACKAGE_RUN" });
});
