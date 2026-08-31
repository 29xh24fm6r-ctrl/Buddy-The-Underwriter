import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parsePortalLinkInput, parsePortalMessage, parsePortalToken, resolvePortalOrigin } from "../requestBoundary";

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

test("portal issuance, delivery, session, and messaging stay fail closed", () => {
  const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
  const create = read("../../../app/api/portal/create-link/route.ts");
  const send = read("../../../app/api/portal/send-link/route.ts");
  const session = read("../../../app/api/portal/session/route.ts");
  const message = read("../../../app/api/portal/messages/send/route.ts");

  assert.match(create, /bank_id: access\.bankId/);
  assert.match(create, /persistence_unproven/);
  assert.match(create, /PORTAL_NO_STORE/);
  assert.doesNotMatch(create, /error\.message/);
  assert.match(send, /isE164\(phone\)/);
  assert.match(send, /portal_link_id: link\.id/);
  assert.match(send, /await revokeLink\(link\.id\)/);
  assert.match(send, /provider_accepted_audit_unproven/);
  assert.doesNotMatch(send, /metadata:\s*\{\s*token/);
  assert.doesNotMatch(send, /error:\s*String/);
  assert.match(session, /session_audit_unavailable/);
  assert.match(session, /Promise\.all\(/);
  assert.match(session, /dealResult\.data\.bank_id !== invite\.bank_id/);
  assert.match(session, /portal_state_unavailable/);
  assert.doesNotMatch(session, /requests:\s*requests\s*\|\|\s*\[\]/);
  assert.match(message, /\.select\("id, deal_id, bank_id, invite_id"\)\.single\(\)/);
  assert.match(message, /data\.bank_id !== invite\.bank_id/);
  assert.match(message, /message_persistence_unavailable/);
  for (const source of [create, send, session, message]) {
    assert.match(source, /no-store, max-age=0|PORTAL_NO_STORE/);
  }
});
