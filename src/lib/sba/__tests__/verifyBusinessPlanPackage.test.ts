import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { verifyBusinessPlanPackage } =
  require("../verifyBusinessPlanPackage") as typeof import("../verifyBusinessPlanPackage");
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

function basePkg(overrides: Record<string, unknown> = {}) {
  return {
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

function setVerifierResponse(flaggedClaims: unknown[]) {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims }),
    tokensIn: 40,
    tokensOut: 20,
  }));
}

test("returns null when the package has no narrative text at all", async () => {
  const db = makeDb({});
  const result = await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg(),
    sb: db,
  });
  assert.equal(result, null);
});

test("verifies whatever narrative sections are present and passes when nothing flagged", async () => {
  setVerifierResponse([]);
  const db = makeDb({});
  const result = await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg({ executive_summary: "DSCR is 1.35x, above the 1.25x policy floor." }),
    sb: db,
  });
  assert.ok(result);
  assert.equal(result?.verdict, "pass");
});

test("returns null when the only present sections are their own per-section fallback strings", async () => {
  const db = makeDb({});
  const result = await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg({
      executive_summary: "Executive summary not available.",
      swot_strengths: "Strengths not available.",
    }),
    sb: db,
  });
  assert.equal(result, null, "per-section 'not available' fallbacks must never be fact-checked as real content");
});

test("excludes a per-section fallback from the draft while still verifying a real sibling section", async () => {
  setVerifierResponse([]);
  let capturedPrompt = "";
  const originalImpl = __setProviderImplForTests;
  originalImpl("anthropic", async (req: any) => {
    capturedPrompt = req.prompt;
    return { text: JSON.stringify({ flaggedClaims: [] }), tokensIn: 40, tokensOut: 20 };
  });

  await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg({
      executive_summary: "DSCR is 1.35x, above the 1.25x policy floor.",
      swot_weaknesses: "Weaknesses not available.",
    }),
    sb: makeDb({}),
  });

  assert.match(capturedPrompt, /DSCR is 1\.35x/);
  assert.doesNotMatch(capturedPrompt, /Weaknesses not available\./);
});

test("franchise_section participates in the draft and its fallback is excluded (audit fix regression)", async () => {
  let capturedPrompt = "";
  __setProviderImplForTests("anthropic", async (req: any) => {
    capturedPrompt = req.prompt;
    return { text: JSON.stringify({ flaggedClaims: [] }), tokensIn: 40, tokensOut: 20 };
  });

  const result = await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg({
      franchise_section: "Item 19 shows median unit revenue of $850,000.",
    }),
    sb: makeDb({}),
  });

  assert.ok(result, "franchise_section alone must be enough to trigger a verification pass");
  assert.match(capturedPrompt, /Item 19 shows median unit revenue/);

  const skipped = await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg({ franchise_section: "Franchise section not available." }),
    sb: makeDb({}),
  });
  assert.equal(skipped, null, "franchise_section's own fallback string must never be fact-checked as real content");
});

test("opens a banker task when a critical claim is flagged", async () => {
  setVerifierResponse([
    { claim: "Break-even revenue is $50,000", reason: "Facts show $500,000.", severity: "critical" },
  ]);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);
  const result = await verifyBusinessPlanPackage({
    dealId: "deal-1",
    bankId: "bank-1",
    pkg: basePkg({ plan_thesis: "Break-even revenue is $50,000, easily achievable." }),
    sb: db,
  });
  assert.equal(result?.verdict, "flagged");
  assert.equal(tables.deal_conditions?.length, 1);
  assert.match(tables.deal_conditions[0].source_key, /^artifact_claim:business_plan:narratives:/);
});
