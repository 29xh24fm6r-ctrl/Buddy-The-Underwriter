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
  assert.ok(isolation.includes('"state_unavailable"'));
});

test("missing or malformed isolation state cannot become a production deal", () => {
  assert.ok(isolation.includes("if (!data)"));
  assert.ok(isolation.includes('"deal_not_found"'));
  assert.ok(isolation.includes('typeof isTest !== "boolean"'));
  assert.ok(!isolation.includes("?.is_test === true"));
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
  assert.ok(isolation.includes('"test_application",'));
  assert.ok(isolation.includes('"not_test_application",'));
});

test("every real-lender distribution route distinguishes block from outage", () => {
  for (const route of routes) {
    assert.ok(route.includes("error instanceof DealIsolationError"));
    assert.ok(route.includes('error.code === "test_application"'));
    assert.ok(route.includes("test_application_distribution_blocked"));
    assert.ok(route.includes("deal_isolation_state_unavailable"));
    const hasExplicit503 =
      route.includes("{ status: 503 }") ||
      route.includes('failure("deal_isolation_state_unavailable", 503)');
    assert.ok(hasExplicit503);
  }
});

test("missing authoritative deal state remains non-disclosing", () => {
  for (const route of routes) {
    assert.ok(route.includes('error.code === "deal_not_found"'));
    const missingAt = route.indexOf('error.code === "deal_not_found"');
    const notFoundAt = route.indexOf("{ status: 404 }", missingAt);
    assert.ok(notFoundAt > missingAt);
  }
});
