import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/components/brokerage/GoldenTridentLab.tsx", "utf8");
const client = readFileSync("src/components/brokerage/GoldenTridentLabClient.tsx", "utf8");
const packagesPage = readFileSync("src/app/admin/brokerage/packages/page.tsx", "utf8");
const generateRoute = readFileSync("src/app/api/brokerage/deals/[dealId]/trident/generate/route.ts", "utf8");
const readiness = readFileSync("src/lib/brokerage/trident/tridentReadiness.ts", "utf8");

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
  assert.match(generateRoute, /\.eq\("bank_id", brokerageBankId\)/);
  assert.doesNotMatch(page + client, /seal-status|marketplace\/pick|marketplace_listings/);
});

test("golden trident lab reads the deployed bundle schema and fails closed on incomplete evidence", () => {
  assert.match(page, /order\("generated_at"/);
  assert.doesNotMatch(page, /order\("created_at"/);
  assert.match(readiness, /assumptionsStatus !== "confirmed"/);
  assert.match(readiness, /documentCount < 2/);
  assert.match(readiness, /financialFactCount < 5/);
  assert.match(generateRoute, /trident_not_ready/);
  assert.match(client, /disabled=\{busy !== null \|\| !readiness\?\.ok\}/);
});

test("golden trident lab reuses the existing packages page slot", () => {
  assert.match(packagesPage, /lab === "golden-trident"/);
  assert.match(packagesPage, /<GoldenTridentLab/);
});
