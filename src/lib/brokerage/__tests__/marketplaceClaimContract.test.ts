import test from "node:test";
import assert from "node:assert/strict";
import { parseMarketplaceClaimRpcResponse } from "../marketplaceClaimContract";

test("accepts the live active-claim RPC contract", () => {
  const parsed = parseMarketplaceClaimRpcResponse({
    status: "active",
    claim_id: "claim-1",
    listing_id: "listing-1",
  });
  assert.equal(parsed?.claimId, "claim-1");
});

test("accepts prior successful RPC contracts", () => {
  assert.equal(
    parseMarketplaceClaimRpcResponse({ status: "claimed", claim_id: "claim-2" })?.claimId,
    "claim-2",
  );
  assert.equal(
    parseMarketplaceClaimRpcResponse({ ok: true, claim_id: "claim-3" })?.claimId,
    "claim-3",
  );
});

test("rejects statuses and payloads that do not prove a claim", () => {
  assert.equal(parseMarketplaceClaimRpcResponse({ status: "full", claim_id: "claim-4" }), null);
  assert.equal(parseMarketplaceClaimRpcResponse({ status: "active" }), null);
  assert.equal(parseMarketplaceClaimRpcResponse(null), null);
});
