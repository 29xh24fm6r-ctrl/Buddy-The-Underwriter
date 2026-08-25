import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gate = readFileSync("src/lib/brokerage/sealingGate.ts", "utf8");
const snapshot = readFileSync("src/lib/brokerage/buildSealedSnapshot.ts", "utf8");
const sealRoute = readFileSync(
  "src/app/api/brokerage/deals/[dealId]/seal/route.ts",
  "utf8",
);

test("distribution is governed by a certified Final Golden Trident", () => {
  assert.match(gate, /\.eq\("mode", "final"\)/);
  assert.match(gate, /release_gate_json\?\.ok !== true/);
  assert.match(gate, /canonical_memo_input_hash !== bundle\.memo_input_hash/);
  assert.doesNotMatch(gate, /\.eq\("mode", "preview"\)/);
});

test("sealed snapshot carries immutable final provenance and artifacts", () => {
  assert.match(snapshot, /tridentFinal: distributionBinding/);
  assert.match(snapshot, /bundleId: String\(trident\.id\)/);
  assert.match(snapshot, /inputHash: String\(trident\.input_hash\)/);
  assert.match(snapshot, /creditMemoId: String\(trident\.source_credit_memo_id\)/);
  assert.match(snapshot, /spreadId: String\(trident\.source_spread_id\)/);
  assert.doesNotMatch(snapshot, /tridentPreview/);
});

test("sealed-package columns point at the same certified artifact set", () => {
  assert.match(sealRoute, /final_business_plan_path: snapshot\.distributionBinding\.artifacts\.businessPlan/);
  assert.match(sealRoute, /final_projections_path: snapshot\.distributionBinding\.artifacts\.projectionsPdf/);
  assert.match(sealRoute, /final_feasibility_path: snapshot\.distributionBinding\.artifacts\.feasibility/);
});
