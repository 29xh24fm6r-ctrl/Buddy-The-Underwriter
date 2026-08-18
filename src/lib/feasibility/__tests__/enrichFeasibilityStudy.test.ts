import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { enrichFeasibilityStudy } = require("../enrichFeasibilityStudy") as typeof import("../enrichFeasibilityStudy");
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

    function matches(row: Row) {
      return filters.every(([k, v]) => row[k] === v);
    }

    const q: any = {
      select() {
        return q;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        rows = rows.filter((r) => r[col] === val);
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

function baseComposite(): any {
  return {
    overallScore: 72,
    recommendation: "Recommended",
    confidenceLevel: "Moderate",
    marketDemand: { score: 70, weight: 0.3 },
    financialViability: { score: 80, weight: 0.3 },
    operationalReadiness: { score: 65, weight: 0.2 },
    locationSuitability: { score: 75, weight: 0.2 },
    criticalFlags: 0,
    warningFlags: 1,
    infoFlags: 0,
    allFlags: [],
    overallDataCompleteness: 0.9,
    dimensionsMissingData: [],
  };
}

test("no-ops when the study row has no narratives yet", async () => {
  const tables: Record<string, Row[]> = {
    buddy_feasibility_studies: [{ id: "study-1", narratives: null }],
  };
  const db = makeDb(tables);
  await enrichFeasibilityStudy({ dealId: "deal-1", bankId: "bank-1", studyId: "study-1", composite: baseComposite(), sb: db });
  assert.equal(tables.buddy_feasibility_studies[0].narrative_citations, undefined);
});

test("writes citations and verification verdict back onto the study row", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims: [] }),
    tokensIn: 20,
    tokensOut: 10,
  }));

  const narratives = {
    executiveSummary: "Overall score is 72/100, Recommended.",
    marketDemandNarrative: "Median household income is $78,400 supports demand.",
    financialViabilityNarrative: "financialViabilityNarrative not available.",
    operationalReadinessNarrative: "operationalReadinessNarrative not available.",
    locationSuitabilityNarrative: "locationSuitabilityNarrative not available.",
    riskAssessment: "riskAssessment not available.",
    recommendation: "recommendation not available.",
    franchiseComparisonNarrative: null,
  };

  const tables: Record<string, Row[]> = {
    buddy_feasibility_studies: [{ id: "study-1", narratives }],
    buddy_research_missions: [{ id: "mission-1", deal_id: "deal-1", status: "complete", completed_at: "2026-01-01" }],
    buddy_research_evidence: [
      { mission_id: "mission-1", claim: "Median household income is $78,400", source_uris: ["https://a.example"] },
    ],
  };
  const db = makeDb(tables);

  await enrichFeasibilityStudy({ dealId: "deal-1", bankId: "bank-1", studyId: "study-1", composite: baseComposite(), sb: db });

  const updated = tables.buddy_feasibility_studies[0];
  assert.equal(updated.verification_verdict, "pass");
  assert.deepEqual(updated.narrative_citations.marketDemandNarrative, {
    urls: ["https://a.example"],
    precise: true,
  });
});

test("still persists citations/verification and opens a banker task when no research mission exists at all", async () => {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims: [] }),
    tokensIn: 20,
    tokensOut: 10,
  }));

  const narratives = {
    executiveSummary: "Overall score is 72/100, Recommended.",
    marketDemandNarrative: "Median household income is $78,400 supports demand.",
    financialViabilityNarrative: "financialViabilityNarrative not available.",
    operationalReadinessNarrative: "operationalReadinessNarrative not available.",
    locationSuitabilityNarrative: "locationSuitabilityNarrative not available.",
    riskAssessment: "riskAssessment not available.",
    recommendation: "recommendation not available.",
    franchiseComparisonNarrative: null,
  };

  const tables: Record<string, Row[]> = {
    buddy_feasibility_studies: [{ id: "study-1", narratives }],
    buddy_research_missions: [],
  };
  const db = makeDb(tables);

  await enrichFeasibilityStudy({ dealId: "deal-1", bankId: "bank-1", studyId: "study-1", composite: baseComposite(), sb: db });

  const updated = tables.buddy_feasibility_studies[0];
  assert.equal(updated.verification_verdict, "pass");
  assert.deepEqual(updated.narrative_citations.marketDemandNarrative, { urls: [], precise: false });
  assert.deepEqual(updated.narrative_citations.executiveSummary, { urls: [], precise: false });
  // No mission at all → zero citations for every research-backed field (all 3
  // CITED_NARRATIVE_FIELDS have non-empty narrative text here) → each opens a task.
  assert.equal(tables.deal_conditions?.length, 3);
});


test("reviewer receives exact same-run financial and management evidence", async () => {
  let reviewPrompt = "";
  __setProviderImplForTests("anthropic", async (request) => {
    reviewPrompt = request.prompt;
    return {
      text: JSON.stringify({ issues: [] }),
      tokensIn: 20,
      tokensOut: 10,
    };
  });

  const narratives = {
    executiveSummary: "Apex is conditionally feasible based on the supplied evidence.",
    marketDemandNarrative: "Market demand requires additional local validation.",
    financialViabilityNarrative:
      "Year 1 DSCR is 1.63x and downside DSCR is 0.78x.",
    operationalReadinessNarrative:
      "Jordan Ellis brings 17 years of industry experience.",
    locationSuitabilityNarrative:
      "No specific property has been selected.",
    riskAssessment:
      "The downside case does not cover annual debt service.",
    recommendation:
      "Resolve the downside coverage risk before approval.",
    franchiseComparisonNarrative: null,
  };
  const tables: Record<string, Row[]> = {
    buddy_feasibility_studies: [{
      id: "study-1",
      projections_package_id: "pkg-current",
      narratives,
      data_completeness: 0.4,
      flags: [{ severity: "critical", dimension: "downsideResilience", message: "Downside DSCR is 0.78x." }],
      market_demand_detail: { overallScore: 50, dataCompleteness: 0 },
      financial_viability_detail: {
        overallScore: 53,
        debtServiceCoverage: { score: 90, detail: "Year 1 DSCR: 1.63x.", dataAvailable: true },
        breakEvenMargin: { score: 80, detail: "Margin of safety: 33.9%.", dataAvailable: true },
        downsideResilience: { score: 10, detail: "Downside DSCR: 0.78x.", dataAvailable: true },
      },
      operational_readiness_detail: {
        overallScore: 78,
        managementExperience: { score: 95, detail: "Lead operator: 17 years in industry.", dataAvailable: true },
      },
      location_suitability_detail: { overallScore: 48, dataCompleteness: 0 },
    }],
    buddy_sba_packages: [
      {
        id: "pkg-stale",
        deal_id: "deal-1",
        assumptions_id: "assumptions-stale",
        projections_annual: [{ year: 1, dscr: 9.99, ebitda: 999999 }],
      },
      {
        id: "pkg-current",
        deal_id: "deal-1",
        assumptions_id: "assumptions-current",
        base_year_data: { revenue: 2400000, ebitda: 360000 },
        projections_annual: [{
          year: 1,
          revenue: 2753880,
          ebitda: 420646,
          totalDebtService: 257634,
          dscr: 1.6327,
        }],
        projections_monthly: Array.from({ length: 120 }, (_, month) => ({
          month: month + 1,
          revenue: 229490,
          debtService: 21469,
          verboseIgnoredDetail: "x".repeat(1000),
        })),
        break_even: { breakEvenRevenue: 1819111, marginOfSafetyPct: 0.339 },
        sensitivity_scenarios: [{ name: "Downside", dscrYear1: 0.78 }],
        sources_and_uses: {
          totalUses: 1000000,
          totalSources: 1000000,
          equityInjection: { actualAmount: 150000, actualPct: 0.15 },
        },
        global_cash_flow: { globalDSCR: 3 },
        balance_sheet_projections: [{ year: 1, cash: -314068 }],
        projections_assumptions_narrative:
          "Projected EBITDA is $420,646 and annual debt service is $257,634.",
      },
    ],
    buddy_sba_assumptions: [
      {
        id: "assumptions-stale",
        deal_id: "deal-1",
        status: "confirmed",
        management_team: [{ name: "Stale Person", yearsInIndustry: 99 }],
      },
      {
        id: "assumptions-current",
        deal_id: "deal-1",
        status: "confirmed",
        confirmed_at: "2026-08-14T21:14:06.733Z",
        revenue_streams: [{ name: "Precision machining", baseAnnualRevenue: 1800000 }],
        cost_assumptions: { cogsPercentYear1: 0.55 },
        working_capital: { targetDSO: 42 },
        loan_impact: { loanAmount: 850000, equityInjectionAmount: 150000 },
        management_team: [{
          name: "Jordan Ellis",
          title: "Founder and President",
          yearsInIndustry: 17,
          ownershipPct: 100,
        }],
      },
    ],
    buddy_research_missions: [],
  };
  const db = makeDb(tables);

  await enrichFeasibilityStudy({
    dealId: "deal-1",
    bankId: "bank-1",
    studyId: "study-1",
    composite: baseComposite(),
    sb: db,
  });

  assert.match(reviewPrompt, /"id":"pkg-current"/);
  assert.match(reviewPrompt, /"dscr":1\.6327/);
  assert.match(reviewPrompt, /"ebitda":420646/);
  assert.match(reviewPrompt, /"totalDebtService":257634/);
  assert.match(reviewPrompt, /"dscrYear1":0\.78/);
  assert.match(reviewPrompt, /"actualAmount":150000/);
  assert.match(reviewPrompt, /"cash":-314068/);
  assert.match(reviewPrompt, /"name":"Jordan Ellis"/);
  assert.match(reviewPrompt, /"yearsInIndustry":17/);
  assert.doesNotMatch(reviewPrompt, /pkg-stale|Stale Person|9\.99/);
  assert.doesNotMatch(
    reviewPrompt,
    /monthlyProjections|verboseIgnoredDetail/,
  );
  assert.ok(
    reviewPrompt.length < 30_000,
    `review prompt must stay below 30,000 characters; received ${reviewPrompt.length}`,
  );
});
