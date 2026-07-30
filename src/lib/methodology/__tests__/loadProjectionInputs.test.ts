/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — loadProjectionInputs.ts tests. Extracted
 * from methodology/route.ts's getMethodologyPreview (SPEC-B4); these tests
 * cover the extraction itself (same fact-key list, same formType inference,
 * same "not projectable" reasons) so both the route and the new
 * projections-assumptions narrative stay locked to one loader.
 *
 * Stubs @/lib/supabase/admin via require.cache — same pattern as
 * generateTridentBundle.test.ts — since loadDealMethodology (called
 * internally) reaches for supabaseAdmin() itself rather than accepting an
 * injected client.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    let rows = tables[tableName] ?? [];
    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        rows = rows.filter((r) => r[col] === val);
        return q;
      },
      neq(col: string, val: any) {
        rows = rows.filter((r) => r[col] !== val);
        return q;
      },
      in(col: string, vals: any[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        const asc = opts?.ascending !== false;
        rows = [...rows].sort((a, b) => {
          if (a[col] === b[col]) return 0;
          return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
        });
        return q;
      },
      limit(n: number) {
        rows = rows.slice(0, n);
        return q;
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
      },
    };
    return q;
  }
  return { from: builder };
}

const methodologyChoicesTable: Row[] = [];

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: { supabaseAdmin: () => makeDb({ deal_methodology_choices: methodologyChoicesTable }) },
} as any;

const { loadProjectionInputsForDeal } =
  require("../loadProjectionInputs") as typeof import("../loadProjectionInputs");

test("returns not-projectable when no proposed annual debt service is set", async () => {
  const db = makeDb({ deal_structural_pricing: [] });
  const result = await loadProjectionInputsForDeal("deal-1", "bank-1", db);
  assert.equal(result.projectable, false);
  if (!result.projectable) assert.match(result.reason, /annual debt service/);
});

test("returns not-projectable when no tax-return facts exist", async () => {
  const db = makeDb({
    deal_structural_pricing: [{ deal_id: "deal-1", annual_debt_service_est: 50000, computed_at: "2026-01-01" }],
    deal_financial_facts: [],
  });
  const result = await loadProjectionInputsForDeal("deal-1", "bank-1", db);
  assert.equal(result.projectable, false);
  if (!result.projectable) assert.match(result.reason, /tax-return facts/);
});

test("infers FORM_1065 when GUARANTEED_PAYMENTS is present, else FORM_1120", async () => {
  const db = makeDb({
    deal_structural_pricing: [{ deal_id: "deal-1", annual_debt_service_est: 50000, computed_at: "2026-01-01" }],
    deal_financial_facts: [
      {
        deal_id: "deal-1",
        bank_id: "bank-1",
        fact_key: "GUARANTEED_PAYMENTS",
        fact_value_num: 40000,
        fact_period_end: "2025-12-31",
        is_superseded: false,
        resolution_status: "accepted",
      },
      {
        deal_id: "deal-1",
        bank_id: "bank-1",
        fact_key: "NET_INCOME",
        fact_value_num: 100000,
        fact_period_end: "2025-12-31",
        is_superseded: false,
        resolution_status: "accepted",
      },
    ],
  });
  const result = await loadProjectionInputsForDeal("deal-1", "bank-1", db);
  assert.equal(result.projectable, true);
  if (result.projectable) {
    assert.equal(result.formType, "FORM_1065");
    assert.equal(result.facts.GUARANTEED_PAYMENTS, 40000);
    assert.equal(result.proposedAds, 50000);
  }
});

test("only uses the latest fact_period_end when multiple periods exist", async () => {
  const db = makeDb({
    deal_structural_pricing: [{ deal_id: "deal-1", annual_debt_service_est: 50000, computed_at: "2026-01-01" }],
    deal_financial_facts: [
      {
        deal_id: "deal-1",
        bank_id: "bank-1",
        fact_key: "NET_INCOME",
        fact_value_num: 999999,
        fact_period_end: "2024-12-31",
        is_superseded: false,
        resolution_status: "accepted",
      },
      {
        deal_id: "deal-1",
        bank_id: "bank-1",
        fact_key: "NET_INCOME",
        fact_value_num: 100000,
        fact_period_end: "2025-12-31",
        is_superseded: false,
        resolution_status: "accepted",
      },
    ],
  });
  const result = await loadProjectionInputsForDeal("deal-1", "bank-1", db);
  assert.equal(result.projectable, true);
  if (result.projectable) {
    assert.equal(result.facts.NET_INCOME, 100000);
    assert.equal(result.formType, "FORM_1120");
  }
});
