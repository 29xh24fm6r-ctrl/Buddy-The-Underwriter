import assert from "node:assert/strict";
import test from "node:test";
import { parsePortalLinkInput, parsePortalMessage, parsePortalToken, resolvePortalOrigin } from "../requestBoundary.ts";

const deal_id = "123e4567-e89b-42d3-a456-426614174000";

test("portal request boundary accepts only bounded authoritative inputs", () => {
  assert.deepEqual(parsePortalLinkInput({ deal_id }), { dealId: deal_id, label: "Borrower docs", expiresHours: 72, singleUse: true, channel: null });
  assert.equal(parsePortalLinkInput({ deal_id, expires_hours: 0 }), null);
  assert.equal(parsePortalLinkInput({ deal_id, expires_hours: 721 }), null);
  assert.equal(parsePortalLinkInput({ deal_id, label: "x".repeat(121) }), null);
  assert.equal(parsePortalToken("short"), null);
  assert.equal(parsePortalToken("x".repeat(16)), "x".repeat(16));
  assert.equal(parsePortalMessage(" ", null), null);
  assert.equal(parsePortalMessage("x".repeat(4001), null), null);
  assert.deepEqual(parsePortalMessage(" hello ", " Borrower "), { body: "hello", authorName: "Borrower" });
  assert.equal(resolvePortalOrigin(undefined, "production"), null);
  assert.equal(resolvePortalOrigin("http://example.com", "production"), null);
  assert.equal(resolvePortalOrigin("https://example.com/path", "production"), "https://example.com");
});
