/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — verifyMemoNarratives.ts tests. Same fake-
 * Supabase-client convention as hostileInterrogation.test.ts (M6) /
 * artifactVerification.test.ts (M8) for the deal_conditions banker-task
 * side effect.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { verifyMemoNarratives } =
  require("../verifyMemoNarratives") as typeof import("../verifyMemoNarratives");
const { FALLBACK_NARRATIVES, buildNarrativeInput } =
  require("../narrativeAssembly") as typeof import("../narrativeAssembly");
const { __setProviderImplForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../../../ai/gateway") as typeof import("../../../ai/gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../../../ai/vendorApproval") as typeof import("../../../ai/vendorApproval");

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
    const rows = tables[tableName] ?? (tables[tableName] = []);
    let filters: Array<[string, any]> = [];
    let op: "select" | "insert" = "select";
    let payload: any = null;

    function matches(row: Row) {
      return filters.every(([k, v]) => row[k] === v);
    }

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return q;
      },
      insert(p: any) {
        op = "insert";
        payload = p;
        return q;
      },
      maybeSingle() {
        return Promise.resolve(exec());
      },
      then(onFulfilled: any, onRejected: any) {
        return execPromise().then(onFulfilled, onRejected);
      },
    };

    function exec() {
      if (op === "insert") {
        rows.push({ id: `gen-${rows.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      const found = rows.find(matches) ?? null;
      return { data: found, error: null };
    }

    async function execPromise() {
      return exec();
    }

    return q;
  }
  return { from: builder };
}

function fixtureMemo(): any {
  return {
    deal_id: "deal-1",
    bank_id: "bank-1",
    version: "canonical_v1",
    generated_at: "2026-05-05T00:00:00.000Z",
    header: { deal_name: "Acme Bakery Expansion", borrower_name: "Acme Bakery LLC" },
    key_metrics: {
      loan_amount: { value: 500000 },
      product: "sba_7a",
      rate_summary: "Prime + 2.75%",
      dscr_uw: { value: 1.35 },
      dscr_stressed: { value: 1.1 },
      ltv_gross: { value: 0.72 },
      debt_yield: { value: 0.11 },
      cap_rate: { value: 0.08 },
      stabilization_status: "stabilized",
    },
    transaction_overview: { loan_request: { purpose: "Equipment purchase", term_months: 120 } },
    financial_analysis: {
      noi: { value: 120000 },
      cash_flow_available: { value: 150000 },
      debt_service: { value: 110000 },
      excess_cash_flow: { value: 40000 },
      revenue: { value: 1200000 },
      ebitda: { value: 200000 },
      net_income: { value: 130000 },
      ratio_analysis: [],
      debt_coverage_table: [
        { label: "FY2025", revenue: 2400000, cash_flow_available: 360000, debt_service: 137616, dscr: 2.62 },
      ],
      balance_sheet_table: [
        { period_end: "2025-12-31", total_assets: 1680000, total_liabilities: 830000, mortgages_notes_bonds: 620000, total_equity: 850000 },
      ],
    },
    recommendation: { risk_grade: "B", verdict: "approve", headline: "Strong deal" },
    covenant_package: undefined,
    collateral: {
      gross_value: { value: 600000 },
      net_value: { value: 550000 },
      valuation: { as_is: { value: 500000 }, stabilized: { value: 600000 } },
    },
    risk_factors: [],
    policy_exceptions: [],
    borrower_sponsor: { sponsors: [] },
    global_cash_flow: { global_cash_flow: { value: 150000 }, global_dscr: { value: 1.3 } },
    stress_testing: undefined,
    qualitative_assessment: undefined,
    business_summary: {
      business_description: "A regional bakery chain.",
      seasonality: "moderate",
      revenue_mix: "wholesale/retail",
      geography: "Pacific Northwest",
      years_in_operation: 12,
    },
    business_industry_analysis: undefined,
  };
}

function setVerifierResponse(flaggedClaims: unknown[]) {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims }),
    tokensIn: 50,
    tokensOut: 30,
  }));
}

test("exposes governed leverage anchors and period DSCR bases to generation and review", () => {
  const input = buildNarrativeInput(fixtureMemo());
  assert.deepEqual(input.balance_sheet, [{
    period_end: "2025-12-31",
    total_assets: 1680000,
    total_liabilities: 830000,
    long_term_debt: 620000,
    total_equity: 850000,
  }]);
  assert.deepEqual(input.financial_trend, [{
    label: "FY2025",
    revenue: 2400000,
    cash_flow_available: 360000,
    dscr: 2.62,
  }]);
  assert.equal(input.debt_service, 110000);
  assert.equal(input.dscr_uw, 1.35);
});

test("returns null (skips verification) when generation fell back to FALLBACK_NARRATIVES", async () => {
  const db = makeDb({});
  const result = await verifyMemoNarratives({
    dealId: "deal-1",
    bankId: "bank-1",
    memo: fixtureMemo(),
    narratives: FALLBACK_NARRATIVES,
    sb: db,
  });
  assert.equal(result, null);
});

test("verifies real narrative text and passes when nothing is flagged", async () => {
  setVerifierResponse([]);
  const db = makeDb({});

  const narratives = {
    ...FALLBACK_NARRATIVES,
    executive_summary: "DSCR is 1.35x, comfortably above the 1.25x policy minimum.",
  };

  const result = await verifyMemoNarratives({
    dealId: "deal-1",
    bankId: "bank-1",
    memo: fixtureMemo(),
    narratives,
    sb: db,
  });

  assert.ok(result);
  assert.equal(result?.verdict, "pass");
  assert.equal(result?.reviewPasses, 1);
});

test("opens a banker task via the shared helper when a critical claim is flagged", async () => {
  setVerifierResponse([
    { claim: "DSCR is 3.0x", reason: "Facts show 1.35x, not 3.0x.", severity: "critical" },
  ]);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  const narratives = {
    ...FALLBACK_NARRATIVES,
    executive_summary: "DSCR is 3.0x, an exceptionally strong cushion.",
  };

  const result = await verifyMemoNarratives({
    dealId: "deal-1",
    bankId: "bank-1",
    memo: fixtureMemo(),
    narratives,
    sb: db,
  });

  assert.equal(result?.verdict, "flagged");
  assert.equal(tables.deal_conditions?.length, 1);
  assert.match(tables.deal_conditions[0].source_key, /^artifact_claim:credit_memo:narratives:/);
});
