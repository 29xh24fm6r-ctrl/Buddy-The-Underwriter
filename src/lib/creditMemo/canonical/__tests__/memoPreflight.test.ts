import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runMemoPreflight, formatPreflightFindings } =
  require("../memoPreflight") as typeof import("../memoPreflight");

/**
 * The contradictions below are transcribed from
 * buddy_trident_bundles.generation_error on runs 6fb4c730 and eb5a611c, both
 * of which died at canonical_credit after spending four reviews and three
 * repairs on defects the repair pass could not fix.
 */

function input(over: Partial<Parameters<typeof runMemoPreflight>[0]> = {}) {
  return {
    governedDscrFloor: 1.2,
    stressPolicyDscrFloor: 1.2,
    covenantDscrThreshold: 1.2,
    policyExceptions: [],
    ratioBenchmarkNotes: [],
    governedFields: { revenue: 2_753_880, net_income: 210_000, ebitda: 360_000, total_assets: 1_680_000 },
    derivedFigures: [],
    contractBlockers: [],
    ...over,
  };
}

test("a self-consistent memo passes", () => {
  const result = runMemoPreflight(input());
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test("the covenant/stress floor disagreement the reviewer blocked on is caught", () => {
  // "the covenant_rationale sets a 1.20x floor while the stress module uses
  //  1.25x for breakeven. This is a genuine credit-policy gap"
  const result = runMemoPreflight(
    input({ governedDscrFloor: 1.25, stressPolicyDscrFloor: 1.25, covenantDscrThreshold: 1.2 }),
  );

  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.code === "dscr_floor_disagreement_covenant");
  assert.ok(finding, "expected the covenant disagreement to be named");
  assert.match(finding.detail, /1\.20x/);
  assert.match(finding.detail, /1\.25x/);
});

test("a policy exception citing a threshold this deal does not carry is caught", () => {
  // A small 7(a) resolves 1.20. Asserting a breach against 1.25 fabricates one.
  const result = runMemoPreflight(
    input({
      policyExceptions: ["DSCR of 1.22x is below policy minimum of 1.25x"],
    }),
  );

  assert.equal(result.ok, false);
  const finding = result.findings.find(
    (f) => f.code === "policy_exception_cites_unresolved_threshold",
  );
  assert.ok(finding);
  assert.match(finding.detail, /governed floor is 1\.20x/);
});

test("an exception citing the governed floor is fine", () => {
  const result = runMemoPreflight(
    input({ policyExceptions: ["DSCR of 1.11x is below policy minimum of 1.20x"] }),
  );
  assert.equal(result.ok, true);
});

test("a benchmark quoting a healthy band above the floor is not a contradiction", () => {
  const result = runMemoPreflight(
    input({ ratioBenchmarkNotes: ["Governed minimum: 1.20x. Healthy: ≥1.44x."] }),
  );
  assert.equal(result.ok, true);
});

test("a figure derived from a field that was never supplied is caught", () => {
  // "This asset base is a derived inference chained off an already-inferred
  //  net income (~$190,000 itself derived from applying the net margin to
  //  revenue). ROA per the evidence is Net Income / Assets, but net income is
  //  not a supplied field"
  const result = runMemoPreflight(
    input({
      governedFields: { revenue: 2_753_880, net_income: null, ebitda: 360_000, total_assets: 1_680_000 },
      derivedFigures: [{ label: "Return on Assets", derivedFrom: ["net_income", "total_assets"] }],
    }),
  );

  assert.equal(result.ok, false);
  const finding = result.findings.find((f) => f.code === "derived_figure_without_governed_basis");
  assert.ok(finding);
  assert.match(finding.detail, /Return on Assets/);
  assert.match(finding.detail, /net_income/);
});

test("the same figure is fine once its basis is governed", () => {
  const result = runMemoPreflight(
    input({ derivedFigures: [{ label: "Return on Assets", derivedFrom: ["net_income", "total_assets"] }] }),
  );
  assert.equal(result.ok, true);
});

test("a missing required narrative field blocks instead of being logged", () => {
  // validateMemoNarrative returned severity "block" and the call site logged
  // it and carried on.
  const result = runMemoPreflight(
    input({ contractBlockers: ["risks: At least one risk factor is required"] }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === "memo_narrative_contract_incomplete"));
});

test("an unresolved floor warns without blocking", () => {
  // Nothing to compare against is a gap worth stating, not a contradiction.
  const result = runMemoPreflight(
    input({ governedDscrFloor: null, stressPolicyDscrFloor: null, covenantDscrThreshold: null }),
  );

  assert.equal(result.ok, true);
  assert.ok(result.findings.some((f) => f.code === "dscr_floor_unresolved" && f.severity === "warn"));
});

test("findings format into one actionable line", () => {
  const result = runMemoPreflight(input({ covenantDscrThreshold: 1.35 }));
  const text = formatPreflightFindings(result.findings);

  assert.match(text, /block: dscr_floor_disagreement_covenant/);
  assert.match(text, /1\.35x/);
});

test("the deal's own coverage in an exception is not mistaken for a threshold", () => {
  // "DSCR of 1.11x is below policy minimum of 1.20x" states two multiples.
  // Only the second is a policy claim; flagging the first would reject a
  // correctly worded exception.
  const result = runMemoPreflight(
    input({ policyExceptions: ["DSCR of 1.11x is below policy minimum of 1.20x"] }),
  );
  assert.equal(result.ok, true, formatPreflightFindings(result.findings));
});

test("a threshold asserted without the word 'minimum' is still caught", () => {
  const result = runMemoPreflight(
    input({ policyExceptions: ["Coverage falls below the 1.25x institutional floor"] }),
  );
  assert.equal(result.ok, false);
});
