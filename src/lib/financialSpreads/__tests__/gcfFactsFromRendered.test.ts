import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  extractGcfFactsFromRendered,
  readRenderedRowNumber,
  type RenderedLike,
} from "@/lib/financialSpreads/gcfFactsFromRendered";

/**
 * SPEC-GCF-READY-SPREAD-MUST-MATERIALIZE-CANONICAL-FACTS-1
 *
 * A ready GLOBAL_CASH_FLOW rendered_json must materialize the canonical facts.
 * On deal dc52c626 the spread showed GCF=103,865.47 / DSCR=1.0258… but
 * deal_financial_facts had zero GCF rows, so memo readiness kept blocking.
 */

// The exact rendered shape observed on dc52c626 (cells = { value: n }).
function dc52c626Rendered(): RenderedLike {
  return {
    rows: [
      { key: "GCF_PERSONAL_INCOME", values: [{ value: 50000 }] },
      { key: "GCF_GLOBAL_CASH_FLOW", values: [{ value: 103865.47 }] },
      { key: "GCF_DSCR", values: [{ value: 1.0258318024691357 }] },
      { key: "GCF_CASH_AVAILABLE", values: [{ value: 103865.47 }] },
    ],
  };
}

test("ready GCF rendered_json materializes all four canonical facts", () => {
  const facts = extractGcfFactsFromRendered(dc52c626Rendered());
  const byKey = new Map(facts.map((f) => [f.factKey, f.value]));

  assert.equal(byKey.get("GCF_GLOBAL_CASH_FLOW"), 103865.47);
  assert.equal(byKey.get("GCF_DSCR"), 1.0258318024691357);
  assert.equal(byKey.get("GCF_CASH_AVAILABLE"), 103865.47);
  // Legacy alias mirrors the canonical value.
  assert.equal(byKey.get("GLOBAL_CASH_FLOW"), 103865.47);

  for (const key of [
    "GCF_GLOBAL_CASH_FLOW",
    "GCF_DSCR",
    "GCF_CASH_AVAILABLE",
    "GLOBAL_CASH_FLOW",
  ]) {
    assert.ok(byKey.has(key), `must materialize ${key}`);
  }
});

test("legacy GLOBAL_CASH_FLOW alias always equals the canonical GCF value", () => {
  const facts = extractGcfFactsFromRendered(dc52c626Rendered());
  const canonical = facts.find((f) => f.factKey === "GCF_GLOBAL_CASH_FLOW")?.value;
  const legacy = facts.find((f) => f.factKey === "GLOBAL_CASH_FLOW")?.value;
  assert.equal(legacy, canonical);
});

test("tolerates bare-number cells (not just { value })", () => {
  const rendered: RenderedLike = {
    rows: [
      { key: "GCF_GLOBAL_CASH_FLOW", values: [103865.47] },
      { key: "GCF_DSCR", values: [1.0258318024691357] },
      { key: "GCF_CASH_AVAILABLE", values: [103865.47] },
    ],
  };
  assert.equal(readRenderedRowNumber(rendered, "GCF_GLOBAL_CASH_FLOW"), 103865.47);
  const byKey = new Map(extractGcfFactsFromRendered(rendered).map((f) => [f.factKey, f.value]));
  assert.equal(byKey.get("GCF_GLOBAL_CASH_FLOW"), 103865.47);
  assert.equal(byKey.get("GLOBAL_CASH_FLOW"), 103865.47);
});

test("skips null / non-finite values; no canonical → no legacy alias", () => {
  const rendered: RenderedLike = {
    rows: [
      { key: "GCF_GLOBAL_CASH_FLOW", values: [{ value: null }] },
      { key: "GCF_DSCR", values: [{ value: 1.2 }] },
    ],
  };
  const keys = extractGcfFactsFromRendered(rendered).map((f) => f.factKey);
  assert.ok(!keys.includes("GCF_GLOBAL_CASH_FLOW"));
  assert.ok(!keys.includes("GLOBAL_CASH_FLOW")); // alias only when canonical present
  assert.deepEqual(keys, ["GCF_DSCR"]);
});

test("render path awaits GCF materialization and surfaces failures (not fire-and-forget)", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/lib/financialSpreads/renderSpread.ts"),
    "utf8",
  );
  assert.ok(
    /await persistGcfComputedFacts\(/.test(src),
    "GCF fact persistence must be awaited, not fire-and-forget",
  );
  assert.ok(
    !/persistGcfComputedFacts\(\{[\s\S]{0,120}\}\)\.catch\(/.test(src),
    "the swallowing .catch() on persistGcfComputedFacts must be gone",
  );
  assert.ok(
    /GCF_FACT_MATERIALIZE_(INCOMPLETE|FAILED)/.test(src),
    "persistence failures must surface a visible Aegis system event",
  );
  assert.ok(
    /extractGcfFactsFromRendered/.test(src),
    "render path must use the shared extractor (writes the legacy alias too)",
  );
});
