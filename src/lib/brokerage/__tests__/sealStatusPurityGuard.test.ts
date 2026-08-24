import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/brokerage/deals/[dealId]/seal-status/route.ts",
  "utf8",
);

test("seal-status polling remains a bounded read-only query", () => {
  assert.doesNotMatch(route, /generateTridentBundle/);
  assert.doesNotMatch(route, /ensureAssumptionsForPreview/);
  assert.doesNotMatch(route, /computeBuddySBAScore/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(route, /Status polling is deliberately read-only/);
});
