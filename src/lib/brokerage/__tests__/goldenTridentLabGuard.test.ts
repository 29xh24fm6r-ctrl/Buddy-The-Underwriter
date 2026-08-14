import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/admin/brokerage/golden-trident/page.tsx", "utf8");
const client = readFileSync("src/components/brokerage/GoldenTridentLabClient.tsx", "utf8");

test("golden trident lab invokes the real final-mode generator", () => {
  assert.match(client, /trident\/generate/);
  assert.match(client, /mode:\s*"final"/);
  assert.doesNotMatch(page, /buddy_trident_bundles[\s\S]{0,120}\.insert\(/);
});

test("golden trident lab exposes every quality-review surface", () => {
  for (const label of ["Business plan", "Projections", "Feasibility study", "Financial spreads", "Credit memo", "Confirmed projection assumptions"]) {
    assert.ok(page.includes(label), `missing ${label}`);
  }
  assert.match(page, /classic-spread/);
  assert.match(page, /credit-memo\/canonical\/pdf/);
});

test("golden trident lab is tenant scoped and does not advance marketplace state", () => {
  assert.match(page, /\.eq\("bank_id", brokerageBankId\)/);
  assert.doesNotMatch(page + client, /seal-status|marketplace\/pick|marketplace_listings/);
});
