/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 7 tests.
 *
 * All products compile through one contract; required metric/doc/covenant
 * surfaces are non-empty and registry-consistent; the missing-data blocker
 * system fires and clears correctly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCT_KEYS,
  allProductDefinitions,
  getProductDefinition,
  evaluateProductReadiness,
} from "@/lib/finengine/products";
import { CANONICAL_METRIC_IDS } from "@/lib/finengine/registry/metricRegistry";

describe("PR7 — common contract compiles for every product", () => {
  it("all 14 products yield a definition with required surfaces", () => {
    const defs = allProductDefinitions();
    assert.equal(defs.length, PRODUCT_KEYS.length);
    for (const d of defs) {
      assert.ok(d.requiredMetrics.length > 0, `${d.product} metrics`);
      assert.ok(d.requiredDocuments.length > 0, `${d.product} docs`);
      assert.ok(d.recommendedCovenants.length > 0, `${d.product} covenants`);
      assert.ok(d.riskFactors.length > 0, `${d.product} risks`);
    }
  });

  it("required metrics reference only canonical registry metrics", () => {
    for (const d of allProductDefinitions()) {
      for (const m of d.requiredMetrics) assert.ok(CANONICAL_METRIC_IDS.has(m), `${d.product}:${m}`);
    }
  });
});

describe("PR7 — missing-data blocker system", () => {
  const CI = "CI_TERM" as const;
  const def = getProductDefinition(CI);
  const allMetrics = Object.fromEntries(def.requiredMetrics.map((m) => [m, 1]));
  const allDocs = [...def.requiredDocuments];

  it("no blockers when all metrics + docs present", () => {
    const r = evaluateProductReadiness({ product: CI, computedMetrics: allMetrics, availableDocuments: allDocs });
    assert.equal(r.ready, true);
    assert.deepEqual(r.blockers, []);
  });

  it("blocks on a missing required metric", () => {
    const missingOne = { ...allMetrics };
    delete missingOne[def.requiredMetrics[0]];
    const r = evaluateProductReadiness({ product: CI, computedMetrics: missingOne, availableDocuments: allDocs });
    assert.equal(r.ready, false);
    assert.ok(r.missingMetrics.includes(def.requiredMetrics[0]));
    assert.ok(r.blockers.some((b) => b.kind === "missing_metric"));
  });

  it("treats a null metric as not computed", () => {
    const withNull = { ...allMetrics, [def.requiredMetrics[0]]: null };
    const r = evaluateProductReadiness({ product: CI, computedMetrics: withNull, availableDocuments: allDocs });
    assert.equal(r.ready, false);
  });

  it("blocks on a missing required document", () => {
    const r = evaluateProductReadiness({ product: CI, computedMetrics: allMetrics, availableDocuments: [] });
    assert.equal(r.ready, false);
    assert.ok(r.missingDocuments.length > 0);
    assert.ok(r.blockers.some((b) => b.kind === "missing_document"));
  });

  it("matches documents case-insensitively", () => {
    const lower = def.requiredDocuments.map((d) => d.toLowerCase());
    const r = evaluateProductReadiness({ product: CI, computedMetrics: allMetrics, availableDocuments: lower });
    assert.equal(r.missingDocuments.length, 0);
  });
});

describe("PR7 — product distinctiveness", () => {
  it("CRE investor requires appraisal + rent roll; CI term does not require appraisal", () => {
    const cre = getProductDefinition("CRE_INVESTOR");
    const ci = getProductDefinition("CI_TERM");
    assert.ok(cre.requiredDocuments.includes("APPRAISAL"));
    assert.ok(cre.requiredDocuments.includes("RENT_ROLL"));
    assert.ok(!ci.requiredDocuments.includes("APPRAISAL"));
  });
  it("construction requires an in-balance covenant", () => {
    assert.ok(getProductDefinition("CONSTRUCTION").recommendedCovenants.includes("IN_BALANCE_REQUIREMENT"));
  });
  it("SBA products carry eligibility risk factor", () => {
    assert.ok(getProductDefinition("SBA_7A").riskFactors.includes("eligibility"));
    assert.ok(getProductDefinition("SBA_504").riskFactors.includes("eligibility"));
  });
});
