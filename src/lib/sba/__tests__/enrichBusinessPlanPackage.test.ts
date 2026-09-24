import { reviewCheckpointRpc } from "../../../../test/utils/reviewCheckpointClient";
import test from "node:test";
import { BUSINESS_PLAN_REQUIREMENTS } from "@/lib/brokerage/trident/narrativeAcceptance";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

const completeProse = "The proposed project depends on the borrower assumptions and deterministic calculations supplied for this review. Independent supporting evidence remains unavailable. The lender should verify the proposed operating arrangements and assess their effect on projected performance before reaching a credit decision. This analysis does not establish historical performance or approval of financing.";

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
  tables.deals ??= [{ id: "deal-1", bank_id: "bank-1", name: "QA Borrower" }];
  function builder(tableName: string) {
    const stored = tables[tableName] ?? (tables[tableName] = []);
    let rows = [...stored];
    let filters: Array<[string, any]> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: any = null;

    const q: any = {
      order() { return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
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
  return { from: builder, rpc: reviewCheckpointRpc() };
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
    ...Object.fromEntries(Object.keys(BUSINESS_PLAN_REQUIREMENTS).map(key => [key, completeProse])),
    ...Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, key in BUSINESS_PLAN_REQUIREMENTS && typeof value === "string" ? `${value} ${completeProse}` : value])),
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

test("gives the verifier borrower-confirmed management, staffing, and ramp assumptions", async () => {
  let providerInput = "";
  __setProviderImplForTests("anthropic", async (input: any) => {
    providerInput = JSON.stringify(input);
    return { text: JSON.stringify({ issues: [] }), tokensIn: 20, tokensOut: 10 };
  });
  const tables: Record<string, Row[]> = {
    buddy_sba_packages: [basePkgRow({ executive_summary: "Jordan Ellis leads the second-shift expansion." })],
    buddy_sba_assumptions: [{
      deal_id: "deal-1",
      status: "confirmed",
      confirmed_at: "2026-08-14T21:14:06.733Z",
      revenue_streams: [{ name: "Precision machining", baseAnnualRevenue: 1_800_000 }],
      cost_assumptions: { plannedHires: [{ role: "CNC operator", startMonth: 4, annualSalary: 65_000 }] },
      working_capital: { targetDSO: 42 },
      loan_impact: { revenueImpactStartMonth: 4, revenueImpactPct: 0.08 },
      management_team: [{ name: "Jordan Ellis", yearsInIndustry: 17 }],
    }],
  };

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb(tables) });

  assert.match(providerInput, /Jordan Ellis/);
  assert.match(providerInput, /CNC operator/);
  assert.match(providerInput, /65000/);
  assert.match(providerInput, /revenueImpactStartMonth/);
});

test("does not treat unconfirmed assumptions as immutable review evidence", async () => {
  let providerInput = "";
  __setProviderImplForTests("anthropic", async (input: any) => {
    providerInput = JSON.stringify(input);
    return { text: JSON.stringify({ issues: [] }), tokensIn: 20, tokensOut: 10 };
  });
  const tables: Record<string, Row[]> = {
    buddy_sba_packages: [basePkgRow({ executive_summary: "A decision-useful summary." })],
    buddy_sba_assumptions: [{
      deal_id: "deal-1", status: "draft", management_team: [{ name: "Unconfirmed Person" }],
    }],
  };

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb(tables) });

  assert.doesNotMatch(providerInput, /Unconfirmed Person/);
});

test("leaves verification columns null when the package has no real narrative content", async () => {
  const tables: Record<string, Row[]> = { buddy_sba_packages: [basePkgRow(Object.fromEntries(Object.keys(BUSINESS_PLAN_REQUIREMENTS).map(key => [key, null])))] };
  const db = makeDb(tables);

  await enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: db });

  const updated = tables.buddy_sba_packages[0];
  assert.equal(updated.verification_verdict, null);
  assert.equal(updated.verification_flagged_claims, null);
});

test("opens a banker task when a critical claim is flagged, via the shared deal_conditions pattern", async () => {
  __setVendorApprovalForTests("openai", "APPROVED");
  __setProviderImplForTests("openai", async req => {
    const allSections = JSON.parse(req.prompt.split("SECTIONS TO REPAIR (claims here are not evidence):\n\n")[1].split("\n\n")[0]);
    const keys = JSON.parse(req.prompt.split("REQUESTED REPAIR SECTION KEYS:\n\n")[1].split("\n\n")[0]);
    const sections = allSections.filter((section: { key: string }) => keys.includes(section.key));
    return { text: JSON.stringify({ sections }), tokensIn: 1, tokensOut: 1 };
  });
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

test("saved interview reaches review, repair and cache identity without becoming verified financial evidence", async () => {
  __setVendorApprovalForTests("openai", "APPROVED");
  let reviews = 0, repairs = 0;
  const seen: string[] = [];
  __setProviderImplForTests("anthropic", async request => {
    reviews++;
    seen.push(request.prompt);
    assert.match(request.prompt, /250,000 annual transactions/);
    assert.match(request.prompt, /3 to 6 months/);
    assert.match(request.prompt, /30,000 marketing/);
    assert.match(request.prompt, /not independently verified/);
    return { text: JSON.stringify({ issues: reviews === 1 ? [{ sectionKey: "operations_plan", claim: "No opening target was supplied", reason: "Interview supplies a target", severity: "critical", category: "cross_artifact_conflict", repairInstruction: "Preserve the qualified borrower target" }] : [] }), tokensIn: 20, tokensOut: 10 };
  });
  __setProviderImplForTests("openai", async request => {
    repairs++; seen.push(request.prompt);
    assert.match(request.prompt, /250,000 annual transactions/);
    assert.match(request.prompt, /3 to 6 months/);
    assert.match(request.prompt, /not independently verified/);
    return { text: JSON.stringify({ sections: [{ key: "operations_plan", text: `The borrower targets 3 to 6 months; this is not independently verified or contractually committed. ${completeProse}` }] }), tokensIn: 20, tokensOut: 10 };
  });
  const tables: Record<string, Row[]> = {
    buddy_sba_packages: [basePkgRow({ operations_plan: "No opening target was supplied." })],
    borrower_concierge_sessions: [{ deal_id: "deal-1", confirmed_facts: { package_answers: {
      A07: { value: "3 to 6 months", saved_at: "2026-09-23" },
      D04: { value: "Synthetic $4-$8 beverages, $6 average ticket, not independently verified" },
      L03: { value: "Synthetic 250,000 annual transactions; demand unverified" },
      L07: { value: "Synthetic $30,000 marketing and $90,000 royalty provision" },
    } } }],
  };
  const args = { dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb(tables) };
  const first = await enrichBusinessPlanPackage(args);
  assert.equal(first.verdict, "pass"); assert.equal(repairs, 1); assert.equal(reviews, 2);
  const savedHash = tables.buddy_sba_packages[0].verification_input_hash;
  const answers = tables.borrower_concierge_sessions[0].confirmed_facts.package_answers;
  answers.A07.saved_at = "2026-09-24";
  assert.equal((await enrichBusinessPlanPackage(args)).reusedVerdict, true);
  assert.equal(reviews, 2, "metadata alone must not spend on a new review");
  tables.buddy_sba_packages[0].verification_flagged_claims = [{ claim: "Site pending", reason: "Obtain approval", severity: "warning" }];
  assert.equal((await enrichBusinessPlanPackage(args)).advisoryCount, 1, "reuse must retain advisory disclosure");
  answers.A07.value = "3 to 6 months, subject to lender approval";
  assert.equal((await enrichBusinessPlanPackage(args)).reusedVerdict, false);
  assert.notEqual(tables.buddy_sba_packages[0].verification_input_hash, savedHash);
  assert.equal(reviews, 3, "changed borrower evidence invalidates the old pass");
});

test("business-plan review refuses a deal from another bank before any provider call", async () => {
  let calls = 0;
  __setProviderImplForTests("anthropic", async () => { calls++; throw new Error("must not call"); });
  await assert.rejects(enrichBusinessPlanPackage({ dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb({ deals: [{ id: "deal-1", bank_id: "another-bank" }], buddy_sba_packages: [basePkgRow({ executive_summary: "Synthetic" })] }) }), /package_borrower_context_deal_mismatch/);
  assert.equal(calls, 0);
});

test("missing required plan sections enter repair and the completed result is reusable", async () => {
  __setVendorApprovalForTests("openai", "APPROVED");
  let repairs = 0;
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: [] }), tokensIn: 1, tokensOut: 1 }));
  __setProviderImplForTests("openai", async req => {
    repairs++;
    const keys = JSON.parse(req.prompt.split("REQUESTED REPAIR SECTION KEYS:\n\n")[1].split("\n\n")[0]);
    assert.deepEqual(keys, ["swot_opportunities"]);
    return { text: JSON.stringify({ sections: [{ key: "swot_opportunities", text: completeProse }] }), tokensIn: 1, tokensOut: 1 };
  });
  const tables = { buddy_sba_packages: [basePkgRow({ swot_opportunities: null })] };
  const args = { dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb(tables) };
  assert.equal((await enrichBusinessPlanPackage(args)).verdict, "pass");
  assert.equal(tables.buddy_sba_packages[0].swot_opportunities, completeProse);
  assert.equal((await enrichBusinessPlanPackage(args)).reusedVerdict, true);
  assert.equal(repairs, 1);
});

test("cached acceptance cannot skip restoration of a removed protected funding schedule", async () => {
  const { withoutProtectedFundingSchedule } = await import("../../ai/protectedFundingSchedule");
  __setProviderImplForTests("anthropic", async () => ({ text: JSON.stringify({ issues: [] }), tokensIn: 1, tokensOut: 1 }));
  const tables: Record<string, Row[]> = { buddy_sba_packages: [basePkgRow({ sources_and_uses: {
    sources: [{ label: "Loan", amount: 100 }], uses: [{ label: "Working capital", amount: 100 }], totalSources: 100, totalUses: 100,
  } })] };
  const args = { dealId: "deal-1", bankId: "bank-1", packageId: "pkg-1", sb: makeDb(tables) };
  assert.equal((await enrichBusinessPlanPackage(args)).verdict, "pass");
  const accepted = tables.buddy_sba_packages[0].operations_plan;
  assert.match(accepted, /Funding schedule \(saved assumptions\)/);
  assert.equal((await enrichBusinessPlanPackage(args)).reusedVerdict, true);
  tables.buddy_sba_packages[0].operations_plan = withoutProtectedFundingSchedule(accepted);
  assert.equal((await enrichBusinessPlanPackage(args)).reusedVerdict, false);
  assert.equal(tables.buddy_sba_packages[0].operations_plan, accepted);
});
