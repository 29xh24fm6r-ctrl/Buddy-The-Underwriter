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
