import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSelectableNumericFact } from "../acceptance";
import { resolveGcfFactValue, evaluateGcfPrerequisites } from "../canonicalGcfCore";
import { buildCanonicalEngineState } from "@/lib/financials/canonicalEngineState";
import { certifyFactSelection, getCertified } from "@/lib/classicSpread/certification/certifyFactSelection";
import { buildCertifiedSnapshots, selectCertifiedValue, type CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { dealSpreadToMetricResults, buildSpreadMemoSection } from "@/lib/finengine/spread/spreadMemo";
import { validateSpread } from "@/lib/finengine/spread/validateSpread";
import { independentRawSelect } from "@/lib/finengine/spread/selectionGuard";
import { buildFinengineMemoPackage } from "@/lib/finengine/memo/finengineMemoPackage";

const row = (overrides: Partial<CertifiedFactRow> = {}): CertifiedFactRow => ({
  fact_key: "TOTAL_REVENUE", fact_value_num: 500000, fact_period_end: "2025-12-31",
  owner_type: "BORROWER", owner_entity_id: "business-a", is_superseded: false,
  source_canonical_type: "BUSINESS_TAX_RETURN", confidence: 0.9, extractor: "verified",
  ...overrides,
});

describe("accepted financial fact contract", () => {
  for (const retired of [{ is_superseded: true }, { resolution_status: "rejected" },
    { resolution_status: "system_invalidated" }, { resolution_status: " SUPERSEDED " }]) {
    it(`never revives ${JSON.stringify(retired)} in any financial selector`, () => {
      const fact = row(retired);
      assert.equal(isSelectableNumericFact(fact), false);
      assert.equal(selectCertifiedValue(fact.fact_key, "BUSINESS", fact.fact_period_end, [fact]).value, null);
      const cert = certifyFactSelection([{ ...fact, id: "fact", owner_entity_id: "business-a", source_document_id: "doc" }]);
      assert.equal(cert.byKeyPeriod.size, 0);
      assert.equal(resolveGcfFactValue([{ ...fact, fact_key: "GCF_GLOBAL_CASH_FLOW", owner_type: "DEAL" }]).value, null);
      assert.equal(buildCanonicalEngineState([{ ...fact, fact_key: "CASH_FLOW_AVAILABLE", owner_type: "DEAL" }]).cashFlowAvailable.value, null);
      assert.equal(buildCanonicalEngineState([{ ...fact, fact_key: "GCF_GLOBAL_CASH_FLOW", owner_type: "DEAL" }]).gcfGlobalCashFlow.value, null);
      assert.equal(evaluateGcfPrerequisites([{ ...fact, fact_key: "CASH_FLOW_AVAILABLE" }]).prerequisites[0].satisfied, false);
    });
  }

  it("preserves zero and rejects missing/non-finite values", () => {
    assert.equal(isSelectableNumericFact(row({ fact_value_num: 0 })), true);
    for (const value of [null, NaN, Infinity, -Infinity]) assert.equal(isSelectableNumericFact(row({ fact_value_num: value })), false);
  });

  it("requires an entity when same-period observations belong to different businesses", () => {
    const facts = [row(), row({ owner_entity_id: "business-b", fact_value_num: 900000 })];
    assert.equal(selectCertifiedValue("TOTAL_REVENUE", "BUSINESS", "2025-12-31", facts).resolution, "unresolved");
    const snaps = buildCertifiedSnapshots("deal", facts);
    assert.deepEqual(snaps.map(s => [s.entityId, s.facts.TOTAL_REVENUE]), [["business-a", 500000], ["business-b", 900000]]);
    const selection = certifyFactSelection(facts.map((f, i) => ({ ...f, id: `fact-${i}`, owner_entity_id: f.owner_entity_id!, source_document_id: `doc-${i}` })));
    assert.equal(getCertified(selection, "TOTAL_REVENUE", "2025-12-31"), null);
    assert.equal(getCertified(selection, "TOTAL_REVENUE", "2025-12-31", "BORROWER", "business-b")?.value, 900000);
  });

  it("does not compute a growth series between different businesses", () => {
    const spread = computeDealSpread("deal", [
      row({ fact_period_end: "2024-12-31" }),
      row({ owner_entity_id: "business-b", fact_value_num: 900000 }),
    ]);
    assert.ok(spread.snapshots.every(s => s.entityId));
    assert.equal(spread.cells.some(c => c.period === "SERIES"), false);
  });

  it("keeps unassigned observations separate from a named entity", () => {
    const facts = [row(), row({ fact_key: "TOTAL_CURRENT_ASSETS", owner_entity_id: null, fact_value_num: 100000 }),
      row({ fact_key: "TOTAL_CURRENT_LIABILITIES", fact_value_num: 50000 })];
    const spread = computeDealSpread("deal", facts);
    assert.equal(spread.snapshots.length, 2);
    assert.equal(spread.cells.some(c => c.metric === "CURRENT_RATIO"), false);
  });

  it("keeps memo metrics and validation anchors attached to their entity", () => {
    const facts = ["business-a", "business-b"].flatMap((owner_entity_id, index) => [
      row({ owner_entity_id, fact_key: "TOTAL_CURRENT_ASSETS", fact_value_num: (index + 2) * 100000 }),
      row({ owner_entity_id, fact_key: "TOTAL_CURRENT_LIABILITIES", fact_value_num: 100000 }),
    ]);
    const spread = computeDealSpread("deal", facts);
    assert.deepEqual(dealSpreadToMetricResults(spread), []);
    assert.equal(dealSpreadToMetricResults(spread, "BUSINESS", undefined, "business-b").find(m => m.metric === "CURRENT_RATIO")?.value, 3);
    const section = buildSpreadMemoSection(spread);
    assert.match(section.body, /business-a[\s\S]*CURRENT_RATIO: 2\.00x[\s\S]*business-b[\s\S]*CURRENT_RATIO: 3\.00x/);
    const anchors = [
      { metric: "CURRENT_RATIO", period: "2025-12-31", expected: 2, source: "test evidence", entityId: "business-a" },
      { metric: "CURRENT_RATIO", period: "2025-12-31", expected: 3, source: "test evidence", entityId: "business-b" },
    ];
    const validated = validateSpread(spread, { rawRows: facts, hardAnchors: anchors });
    assert.equal(validated.unexpected, 0);
    assert.equal(validated.checks.filter(c => c.metric === "CURRENT_RATIO").length, 2);
    const unscopedAnchor = validateSpread(spread, { hardAnchors: [{ ...anchors[0], entityId: undefined }] });
    assert.equal(unscopedAnchor.cutoverBlocked, true);
  });

  it("does not let an exception for one entity excuse a different entity's divergence", () => {
    const spread = computeDealSpread("deal", ["business-a", "business-b"].flatMap(owner_entity_id => [
      row({ owner_entity_id, fact_key: "TOTAL_CURRENT_ASSETS", fact_value_num: 200000 }),
      row({ owner_entity_id, fact_key: "TOTAL_CURRENT_LIABILITIES", fact_value_num: 100000 }),
    ]));
    for (const cell of spread.cells.filter(c => c.metric === "CURRENT_RATIO")) cell.value = 4;
    const validation = validateSpread(spread, { intended: [{ metric: "CURRENT_RATIO", entityId: "business-a", expected: 4, rationale: "test exception" }] });
    assert.equal(validation.intended, 1);
    assert.equal(validation.unexpected, 1);
    assert.equal(validation.checks.find(c => c.metric === "CURRENT_RATIO" && c.entityId === "business-b")?.classification, "UNEXPECTED");
  });

  it("an excluded high-confidence observation cannot overrule an active fact in the validation oracle", () => {
    const facts = [row({ fact_key: "TOTAL_CURRENT_ASSETS", fact_value_num: 200000 }),
      row({ fact_key: "TOTAL_CURRENT_ASSETS", fact_value_num: 900000, confidence: 1, resolution_status: "rejected" })];
    assert.equal(independentRawSelect(facts, "TOTAL_CURRENT_ASSETS", "BUSINESS", "2025-12-31").value, 200000);
  });

  it("all-rejected inputs cannot produce a cleared memo through an empty validation result", () => {
    const pkg = buildFinengineMemoPackage("deal", [row({ resolution_status: "rejected" })], { borrower: { displayName: "Test" } });
    assert.equal(pkg.spread.snapshots.length, 0);
    assert.equal(pkg.validation.checks.length, 0);
    assert.equal(pkg.gate.allowed, false);
    assert.match(pkg.gate.reason, /No comparable accepted financial evidence/);
  });
});
