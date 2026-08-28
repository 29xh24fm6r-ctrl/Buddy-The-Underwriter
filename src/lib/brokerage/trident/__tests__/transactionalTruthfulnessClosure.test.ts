import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const factory = readFileSync("src/lib/brokerage/trident/generateTridentBundle.ts", "utf8");
const delivery = readFileSync("src/lib/brokerage/packageDelivery.ts", "utf8");
const memo = readFileSync("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts", "utf8");
const engine = readFileSync("src/lib/covenants/covenantRuleEngine.ts", "utf8");

test("Golden Trident policy and persistence boundaries fail closed", () => {
  assert.match(engine, /normalizeCovenantRiskGrade/);
  assert.match(engine, /unsupported_covenant_risk_grade/);
  assert.doesNotMatch(engine, /cfg\.dscrFloors\[grade\] \?\? 1\.20/);
  assert.match(memo, /governedDscrFloor: resolvePolicy\("dscr_floor"/);
  assert.match(factory, /release_gate_persist_failed/);
  assert.match(factory, /\.select\("id"\)\s*\n\s*\.maybeSingle\(\)/);
});

test("package delivery never translates database failure into absent state", () => {
  for (const boundary of [
    "final_bundle", "preview_bundle", "sealed_package", "form_159",
    "credit_memo", "borrower_seal", "marketplace_pick", "lender_bank",
    "borrower_form_159",
  ]) assert.match(delivery, new RegExp("package_state_unavailable:" + boundary));
  assert.match(delivery, /if \(accessError\) return \{ ok: false, error: "package_state_unavailable" \}/);
  assert.match(delivery, /if \(listingError\) return \{ ok: false, error: "package_state_unavailable" \}/);
});
