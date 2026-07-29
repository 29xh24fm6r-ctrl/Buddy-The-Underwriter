/**
 * SPEC-M6 ANTICIPATED-INTERROGATION-1 — structural tripwire confirming the
 * seal route calls the hostile-interrogation generator non-fatally, after
 * every write has already succeeded, never able to fail a seal that has
 * already gone through. Source-grep style, same convention as
 * beatMetricsWiring.test.ts's "Structural Tripwires" section — this route
 * handles cookies/multi-table writes/compensation logic that isn't already
 * covered by a mockable test harness in this repo.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/brokerage/deals/[dealId]/seal/route.ts"),
    "utf8",
  );
}

test("TRIPWIRE: seal route imports runHostileInterrogationForDeal", () => {
  const src = readSrc();
  assert.match(
    src,
    /import\s*\{\s*runHostileInterrogationForDeal\s*\}\s*from\s*["']@\/lib\/brokerage\/hostileInterrogation["']/,
  );
});

test("TRIPWIRE: the interrogation call is wrapped in try/catch, after deals.status is set to sealed", () => {
  const src = readSrc();
  const sealedStatusIdx = src.indexOf('.update({ status: "sealed" })');
  const interrogationIdx = src.indexOf("runHostileInterrogationForDeal(dealId, session.bank_id, sb)");
  assert.ok(sealedStatusIdx > -1, "seal route must set deals.status to sealed");
  assert.ok(interrogationIdx > sealedStatusIdx, "interrogation must run after the deal is marked sealed");

  const tryIdx = src.lastIndexOf("try {", interrogationIdx);
  const catchIdx = src.indexOf("} catch", interrogationIdx);
  assert.ok(tryIdx > -1 && tryIdx < interrogationIdx, "must be inside a try block");
  assert.ok(catchIdx > interrogationIdx, "must be followed by a catch block");
});

test("TRIPWIRE: the interrogation call happens before the route's final success response", () => {
  const src = readSrc();
  const interrogationIdx = src.indexOf("runHostileInterrogationForDeal(dealId, session.bank_id, sb)");
  const finalReturnIdx = src.indexOf("return NextResponse.json({\n    ok: true,\n    sealedPackageId");
  assert.ok(interrogationIdx > -1 && finalReturnIdx > -1);
  assert.ok(interrogationIdx < finalReturnIdx);
});
