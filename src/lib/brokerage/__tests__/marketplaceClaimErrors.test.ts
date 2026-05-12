import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { classifyMarketplaceError } =
  require("../marketplaceClaimErrors") as typeof import("../marketplaceClaimErrors");

test("classifyMarketplaceError maps known atomic-RPC error codes", () => {
  const cases: Array<[string, string, number]> = [
    ["listing_not_found", "listing_not_found", 404],
    ["listing_not_open", "listing_not_open", 409],
    ["claim_cap_reached", "claim_cap_reached", 409],
    ["duplicate_claim", "duplicate_claim", 409],
    ["not_matched", "not_matched", 403],
    ["winner_has_no_claim", "winner_has_no_claim", 409],
    ["listing_not_pickable", "listing_not_pickable", 409],
  ];
  for (const [raw, expectedCode, expectedStatus] of cases) {
    const r = classifyMarketplaceError(raw);
    assert.equal(r.code, expectedCode);
    assert.equal(r.status, expectedStatus);
  }
});

test("classifyMarketplaceError extracts leading lowercase token", () => {
  const r = classifyMarketplaceError("claim_cap_reached (3-claim cap)");
  assert.equal(r.code, "claim_cap_reached");
  assert.equal(r.status, 409);
});

test("classifyMarketplaceError returns 500 for unknown codes", () => {
  const r = classifyMarketplaceError("some_other_error");
  assert.equal(r.code, "some_other_error");
  assert.equal(r.status, 500);
});

test("classifyMarketplaceError handles null/undefined", () => {
  const r1 = classifyMarketplaceError(null);
  assert.equal(r1.code, "marketplace_rpc_failed");
  assert.equal(r1.status, 500);
  const r2 = classifyMarketplaceError(undefined);
  assert.equal(r2.code, "marketplace_rpc_failed");
  assert.equal(r2.status, 500);
});
