import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { enrichBusinessPlanPackage } =
  require("../enrichBusinessPlanPackage") as typeof import("../enrichBusinessPlanPackage");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../../ai/gateway") as typeof import("../../ai/gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../../ai/vendorApproval") as typeof import("../../ai/vendorApproval");

test.beforeEach(() => {
  __setVendorApprovalForTests("anthropic", "APPROVED");
});

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  __resetVendorApprovalForTests();
});

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const stored = tables[tableName] ?? (tables[tableName] = []);
    let rows = [...stored];
    let filters: Array<[string, any]> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: any = null;

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        rows = rows.filter((r) => r[col] === val);
        return q;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        return q;
      },
      update(p: any) {
        op = "update";
        payload = p;
        return q;
      },
      maybeSingle() {
        return Promise.resolve(exec(true));
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(exec(false)).then(onFulfilled, onRejected);
      },
    };

    function exec(single: boolean) {
      if (op === "insert") {
        stored.push({ id: `gen-${stored.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      if (op === "update") {
        for (const row of stored) {
          if (filters.every(([k, v]) => row[k] === v)) Object.assign(row, payload);
        }
        return { data: null, error: null };
      }
      return { data: single ? rows[0] ?? null : rows, error: null };
    }

    return q;
  }
  return { from: builder };
}

function basePkgRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pkg-1",
    dscr_year1_base: 1.35,
    dscr_year2_base: 1.4,
    dscr_year3_base: 1.45,
    dscr_year1_downside: 1.1,
    dscr_below_threshold: false,
    break_even_revenue: 500000,
    margin_of_safety_pct: 0.2,
    use_of_proceeds: [],
    business_overview_narrative: null,
    executive_summary: null,
    industry_analysis: null,
    marketing_strategy: null,
    operations_plan: null,
    swot_strengths: null,
    swot_weaknesses: null,
    swot_opportunities: null,
    swot_threats: null,
    sensitivity_narrative: null,
    plan_thesis: null,
    ...overrides,
  };
}

test("no-ops when the package row doesn't exist", async () => {
  const tables: Record<string, Row[]> = { buddy_sba_packages: [] };
  const db = makeDb(tables);
  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: db });
  assert.equal(tables.buddy_sba_packages.length, 0);
});

test("writes verification_verdict/flagged_claims back onto the package row when narratives are present", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims: [] }),
    tokensIn: 20,
    tokensOut: 10,
  }));

  const tables: Record<string, Row[]> = {
    buddy_sba_packages: [basePkgRow({ executive_summary: "DSCR is 1.35x, above the 1.25x policy floor." })],
  };
  const db = makeDb(tables);

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: db });

  const updated = tables.buddy_sba_packages[0];
  assert.equal(updated.verification_verdict, "pass");
  assert.deepEqual(updated.verification_flagged_claims, []);
});

test("gives the institutional verifier the projection and sources-and-uses truth set", async () => {
  let providerInput = "";
  __setProviderImplForTests("anthropic", async (input: any) => {
    providerInput = JSON.stringify(input);
    return { text: JSON.stringify({ flaggedClaims: [] }), tokensIn: 20, tokensOut: 10 };
  });
  const tables: Record<string, Row[]> = {
    buddy_sba_packages: [basePkgRow({
      executive_summary: "The business projects $2.6 million of first-year revenue funded by an SBA loan and equity injection.",
      projections_annual: [{ year: 1, revenue: 2_600_000, dscr: 1.35 }],
      projections_monthly: [{ month: 1, revenue: 100_000 }],
      sensitivity_scenarios: [{ name: "downside", dscrYear1: 1.1 }],
      sources_and_uses: { sources: [{ label: "SBA loan", amount: 850_000 }, { label: "Equity", amount: 150_000 }] },
      balance_sheet_projections: [{ year: 1, cash: 50_000 }],
      projections_assumptions_narrative: "Revenue is built from borrower-confirmed unit volume and pricing assumptions.",
      base_year_data: { revenue: 2_100_000 },
    })],
  };

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb(tables) });

  assert.match(providerInput, /2[,.]?600[,.]?000/);
  assert.match(providerInput, /850[,.]?000/);
  assert.match(providerInput, /150[,.]?000/);
});

test("leaves verification columns null when the package has no real narrative content", async () => {
  const tables: Record<string, Row[]> = { buddy_sba_packages: [basePkgRow()] };
  const db = makeDb(tables);

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: db });

  const updated = tables.buddy_sba_packages[0];
  assert.equal(updated.verification_verdict, null);
  assert.equal(updated.verification_flagged_claims, null);
});

test("opens a banker task when a critical claim is flagged, via the shared deal_conditions pattern", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({
      flaggedClaims: [{ claim: "Break-even revenue is $50,000", reason: "Facts show $500,000.", severity: "critical" }],
    }),
    tokensIn: 20,
    tokensOut: 10,
  }));

  const tables: Record<string, Row[]> = {
    buddy_sba_packages: [basePkgRow({ plan_thesis: "Break-even revenue is $50,000, easily achievable." })],
  };
  const db = makeDb(tables);

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: db });

  const updated = tables.buddy_sba_packages[0];
  assert.equal(updated.verification_verdict, "flagged");
  assert.equal(tables.deal_conditions?.length, 1);
});
