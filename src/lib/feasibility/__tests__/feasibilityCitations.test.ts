import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const {
  loadDealGroundingSegments,
  attributeFeasibilityCitations,
  flagUncitedFeasibilityFields,
} = require("../feasibilityCitations") as typeof import("../feasibilityCitations");

type Row = Record<string, any>;

function makeDb(tables: Record<string, Row[]>) {
  function builder(tableName: string) {
    const stored = tables[tableName] ?? (tables[tableName] = []);
    let rows = [...stored];
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
      maybeSingle() {
        return Promise.resolve(exec());
      },
      then(onFulfilled: any, onRejected: any) {
        return Promise.resolve(execArray()).then(onFulfilled, onRejected);
      },
    };

    function exec() {
      if (op === "insert") {
        stored.push({ id: `gen-${stored.length + 1}`, ...payload });
        return { data: null, error: null };
      }
      return { data: rows[0] ?? null, error: null };
    }

    function execArray() {
      if (op === "insert") return exec();
      return { data: rows, error: null };
    }

    return q;
  }
  return { from: builder };
}

test("loadDealGroundingSegments returns empty when no completed mission exists", async () => {
  const db = makeDb({ buddy_research_missions: [] });
  const result = await loadDealGroundingSegments("deal-1", db);
  assert.deepEqual(result.segments, []);
  assert.deepEqual(result.allUrls, []);
});

test("loadDealGroundingSegments reshapes evidence rows into GroundingSegments", async () => {
  const db = makeDb({
    buddy_research_missions: [{ id: "mission-1", deal_id: "deal-1", status: "complete", completed_at: "2026-01-01" }],
    buddy_research_evidence: [
      { mission_id: "mission-1", claim: "Median household income is $78,400.", source_uris: ["https://a.example"] },
      { mission_id: "mission-1", claim: "Population grew 12% from 2020-2025.", source_uris: ["https://b.example"] },
    ],
  });
  const result = await loadDealGroundingSegments("deal-1", db);
  assert.equal(result.segments.length, 2);
  assert.deepEqual(new Set(result.allUrls), new Set(["https://a.example", "https://b.example"]));
});

test("attributeFeasibilityCitations marks a real textual match precise, and a fallback non-precise", () => {
  const narratives = {
    executiveSummary: "executiveSummary not available.",
    marketDemandNarrative: "Median household income is $78,400 supports strong demand.",
    financialViabilityNarrative: "DSCR is 1.35x.",
    operationalReadinessNarrative: "operationalReadinessNarrative not available.",
    locationSuitabilityNarrative: "locationSuitabilityNarrative not available.",
    riskAssessment: "riskAssessment not available.",
    recommendation: "recommendation not available.",
    franchiseComparisonNarrative: null,
  } as any;

  const segments = [{ text: "Median household income is $78,400", urls: ["https://a.example"], confidences: [0.9] }];
  const result = attributeFeasibilityCitations(narratives, segments, ["https://fallback.example"]);

  assert.deepEqual(result.marketDemandNarrative, { urls: ["https://a.example"], precise: true });
  // executiveSummary/locationSuitabilityNarrative are placeholder text (non-empty) with no
  // real segment overlap — must fall back to allUrls AND be marked non-precise, so a
  // completeness gate doesn't mistake the fallback for a real citation.
  assert.deepEqual(result.locationSuitabilityNarrative, { urls: ["https://fallback.example"], precise: false });
  assert.deepEqual(result.executiveSummary, { urls: ["https://fallback.example"], precise: false });
});

test("attributeFeasibilityCitations reports precise:false with empty urls when no research exists at all", () => {
  const narratives = {
    executiveSummary: "Some real text.",
    marketDemandNarrative: null,
    financialViabilityNarrative: "DSCR is 1.35x.",
    operationalReadinessNarrative: null,
    locationSuitabilityNarrative: null,
    riskAssessment: null,
    recommendation: null,
    franchiseComparisonNarrative: null,
  } as any;

  const result = attributeFeasibilityCitations(narratives, [], []);
  assert.deepEqual(result.executiveSummary, { urls: [], precise: false });
});

test("flagUncitedFeasibilityFields opens a task for any non-precise field, idempotently — including a non-empty fallback", async () => {
  const tables: Record<string, Row[]> = {};
  const db = makeDb(tables);

  const citations = {
    executiveSummary: { urls: ["https://a.example"], precise: true },
    // Non-empty urls but NOT a real match — must still be flagged (the misattribution fix).
    marketDemandNarrative: { urls: ["https://fallback.example"], precise: false },
    locationSuitabilityNarrative: { urls: [], precise: false },
  };

  const first = await flagUncitedFeasibilityFields({
    dealId: "deal-1",
    bankId: "bank-1",
    studyId: "study-1",
    citations,
    sb: db,
  });
  assert.equal(first.conditionsCreated, 2);
  assert.ok(
    tables.deal_conditions?.some((c) => c.source_key.includes("marketDemandNarrative")),
    "the non-precise-but-non-empty field must still open a task",
  );

  const second = await flagUncitedFeasibilityFields({
    dealId: "deal-1",
    bankId: "bank-1",
    studyId: "study-1",
    citations,
    sb: db,
  });
  assert.equal(second.conditionsCreated, 0);
  assert.equal(second.conditionsSkipped, 2);
});
