import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const isolation = fs.readFileSync(
  path.resolve(__dirname, "../isolation.ts"),
  "utf8",
);

const routes = [
  "../../../app/api/brokerage/deals/[dealId]/seal/route.ts",
  "../../../app/api/brokerage/deals/[dealId]/marketplace/pick/route.ts",
  "../../../app/api/lender/marketplace/package/[accessId]/route.ts",
].map((relativePath) =>
  fs.readFileSync(path.resolve(__dirname, relativePath), "utf8"),
);

test("authoritative test-deal lookup checks query errors before state", () => {
  const readAt = isolation.indexOf("const { data, error }");
  const errorAt = isolation.indexOf("if (error)", readAt);
  const returnAt = isolation.indexOf("return isTest", readAt);
  assert.ok(readAt >= 0);
  assert.ok(errorAt > readAt && errorAt < returnAt);
  assert.match(isolation, /"state_unavailable"/);
});

test("missing or malformed isolation state cannot become a production deal", () => {
  assert.match(isolation, /if (!data)/);
  assert.match(isolation, /"deal_not_found"/);
  assert.match(isolation, /typeof isTest !== "boolean"/);
  assert.doesNotMatch(isolation, /?.(?:is_test)s*===s*true/);
});

test("distribution and cleanup guards retain distinct safe outcomes", () => {
  for (const code of [
    "test_application",
    "not_test_application",
    "deal_not_found",
    "state_unavailable",
  ]) {
    assert.ok(isolation.includes(`"${code}"`), `missing ${code}`);
  }
  assert.match(isolation, /throw new DealIsolationError(s*"test_application"/);
  assert.match(isolation, /throw new DealIsolationError(s*"not_test_application"/);
});

test("every real-lender distribution route distinguishes block from outage", () => {
  for (const route of routes) {
    assert.match(route, /error instanceof DealIsolationError/);
    assert.match(route, /error.code === "test_application"/);
    assert.match(route, /test_application_distribution_blocked/);
    assert.match(route, /deal_isolation_state_unavailable/);
    assert.match(route, /{ status: 503 }/);
  }
});

test("missing authoritative deal state remains non-disclosing", () => {
  for (const route of routes) {
    assert.match(route, /error.code === "deal_not_found"/);
    assert.match(route, /{ ok: false }[sS]*{ status: 404 }/);
  }
});
