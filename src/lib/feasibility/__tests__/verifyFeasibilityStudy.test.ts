import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { verifyFeasibilityStudy } = require("../verifyFeasibilityStudy") as typeof import("../verifyFeasibilityStudy");
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
      return { data: rows.find(matches) ?? null, error: null };
    }

    async function execPromise() {
      return exec();
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

function placeholderNarratives(): any {
  return {
    executiveSummary: "executiveSummary not available.",
    marketDemandNarrative: "marketDemandNarrative generation failed.",
    financialViabilityNarrative: "financialViabilityNarrative not available.",
    operationalReadinessNarrative: "operationalReadinessNarrative not available.",
    locationSuitabilityNarrative: "locationSuitabilityNarrative not available.",
    riskAssessment: "riskAssessment not available.",
    recommendation: "recommendation not available.",
    franchiseComparisonNarrative: null,
  };
}

function setVerifierResponse(flaggedClaims: unknown[]) {
  __setProviderImplForTests("anthropic", async () => ({
    text: JSON.stringify({ flaggedClaims }),
    tokensIn: 40,
    tokensOut: 20,
  }));
}

test("returns null when every narrative field is a placeholder", async () => {
  const db = makeDb({});
  const result = await verifyFeasibilityStudy({
    dealId: "deal-1",
    bankId: "bank-1",
    composite: baseComposite(),
    narratives: placeholderNarratives(),
    sb: db,
  });
  assert.equal(result, null);
});

test("verifies real narrative text and passes when nothing is flagged", async () => {
  setVerifierResponse([]);
  const db = makeDb({});
  const narratives = { ...placeholderNarratives(), executiveSummary: "Overall score is 72/100, Recommended." };
  const result = await verifyFeasibilityStudy({
    dealId: "deal-1",
    bankId: "bank-1",
    composite: baseComposite(),
    narratives,
    sb: db,
  });
  assert.ok(result);
  assert.equal(result?.verdict, "pass");
});

test("opens a banker task when a critical claim is flagged", async () => {
  setVerifierResponse([
    { claim: "Overall score is 95/100", reason: "Facts show 72/100.", severity: "critical" },
  ]);
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);
  const narratives = { ...placeholderNarratives(), executiveSummary: "Overall score is 95/100, Strongly Recommended." };
  const result = await verifyFeasibilityStudy({
    dealId: "deal-1",
    bankId: "bank-1",
    composite: baseComposite(),
    narratives,
    sb: db,
  });
  assert.equal(result?.verdict, "flagged");
  assert.equal(tables.deal_conditions?.length, 1);
  assert.match(tables.deal_conditions[0].source_key, /^artifact_claim:feasibility:narratives:/);
});
