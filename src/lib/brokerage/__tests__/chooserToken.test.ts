import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { signChooserPayload, verifyChooserPayload } from "../chooserToken";

/**
 * Behavioural proof of the chooser-cookie signing contract.
 *
 * Both chooser cookies (the brokerage application chooser and the QA
 * post-OTP chooser) are authentication material: the payload names the
 * identity the request is treated as. #900 extracted signing out of the two
 * cookie modules into this shared helper — at which point the guards in
 * applicationChooser.test.ts and qaChooserSession.test.ts, which grepped
 * those modules for the literal "createHmac", began failing even though the
 * property they exist to protect was intact.
 *
 * These tests assert the property itself rather than the implementation's
 * spelling, so the signer can be refactored again without a false failure —
 * and so a real weakening (a truncated compare, a dropped signature check)
 * fails here instead of passing a substring match.
 */

const KEY = "test-signing-key-00000000000000000000";
const OTHER_KEY = "different-signing-key-1111111111111111";
const PAYLOAD = "borrower@example.com:bank-123:1799999999999";

test("a signed payload round-trips under the same key", () => {
  const token = signChooserPayload(PAYLOAD, KEY);
  assert.equal(verifyChooserPayload(token, KEY), PAYLOAD);
});

test("the payload is not readable as plaintext in the token", () => {
  const token = signChooserPayload(PAYLOAD, KEY);
  assert.equal(token.includes(PAYLOAD), false, "payload must be encoded, not inlined");
});

test("the signature is HMAC-SHA256 over the payload", () => {
  const token = signChooserPayload(PAYLOAD, KEY);
  const signature = token.slice(token.lastIndexOf(".") + 1);
  const expected = crypto.createHmac("sha256", KEY).update(PAYLOAD).digest("hex");
  assert.equal(signature, expected);
  assert.equal(signature.length, 64, "SHA-256 hex digest is 64 characters");
});

test("a token signed with another key is rejected", () => {
  const forged = signChooserPayload(PAYLOAD, OTHER_KEY);
  assert.equal(verifyChooserPayload(forged, KEY), null);
});

test("a tampered payload is rejected", () => {
  const token = signChooserPayload(PAYLOAD, KEY);
  const signature = token.slice(token.lastIndexOf(".") + 1);
  const attackerPayload = Buffer.from("attacker@evil.example:bank-123:1799999999999")
    .toString("base64url");
  assert.equal(verifyChooserPayload(`${attackerPayload}.${signature}`, KEY), null);
});

test("a tampered signature is rejected", () => {
  const token = signChooserPayload(PAYLOAD, KEY);
  const dot = token.lastIndexOf(".");
  const flipped = token.slice(dot + 1).replace(/^./, (c) => (c === "a" ? "b" : "a"));
  assert.equal(verifyChooserPayload(`${token.slice(0, dot)}.${flipped}`, KEY), null);
});

test("malformed tokens are rejected without throwing at the auth boundary", () => {
  // Attacker-controlled lengths and non-hex input must not reach
  // timingSafeEqual, which throws on a length mismatch.
  for (const bad of [
    "",
    ".",
    "no-dot-at-all",
    ".onlysignature",
    "payload.",
    "payload.zzzz",
    `${Buffer.from(PAYLOAD).toString("base64url")}.deadbeef`,
    `${Buffer.from(PAYLOAD).toString("base64url")}.${"f".repeat(63)}`,
    `${Buffer.from(PAYLOAD).toString("base64url")}.${"f".repeat(65)}`,
    `not base64!.${"a".repeat(64)}`,
  ]) {
    assert.doesNotThrow(() => verifyChooserPayload(bad, KEY), `threw on ${JSON.stringify(bad)}`);
    assert.equal(verifyChooserPayload(bad, KEY), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("an empty signing key still distinguishes signatures", () => {
  // Defensive: a misconfigured empty secret must not make every token verify.
  const token = signChooserPayload(PAYLOAD, KEY);
  assert.equal(verifyChooserPayload(token, ""), null);
});
