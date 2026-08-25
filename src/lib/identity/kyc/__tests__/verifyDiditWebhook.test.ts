import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();

const { verifyDiditWebhook } = require("@/lib/identity/kyc/verifyDiditWebhook") as typeof import("@/lib/identity/kyc/verifyDiditWebhook");

/**
 * The old verifier accepted ONLY X-Signature-Simple, over a tuple that had
 * never been checked against a live account, and the route turned any
 * mismatch into a bare 401 with no log line. Two failures were therefore
 * indistinguishable: "Didit never called us" and "Didit called us and we
 * threw the event away". Diagnosing the 2026-08-25 incident required
 * reading Didit's own dashboard metrics to tell them apart.
 */

const SECRET = "whsec_test_secret";
const SESSION = "252f29e1-5d22-4743-a44d-71042bcd0389";

function body(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    session_id: SESSION,
    status: "Approved",
    webhook_type: "status.updated",
    ...overrides,
  });
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function sign(data: string) {
  return createHmac("sha256", SECRET).update(data, "utf8").digest("hex");
}

test("accepts Didit's primary X-Signature (HMAC over the raw body)", () => {
  const raw = body();
  const result = verifyDiditWebhook({
    rawBody: raw,
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: String(nowSeconds()),
    signatureHeader: sign(raw),
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.scheme, "raw_body");
});

test("still accepts the X-Signature-Simple tuple as a fallback", () => {
  const ts = String(nowSeconds());
  const result = verifyDiditWebhook({
    rawBody: body(),
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: ts,
    signatureHeader: null,
    simpleSignatureHeader: sign(`${ts}:${SESSION}:Approved:status.updated`),
    secret: SECRET,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.scheme, "simple");
});

test("a valid raw-body signature is accepted even when no timestamp header is sent", () => {
  // Rejecting on a header the vendor may not send is exactly how a real
  // completion gets discarded. The HMAC already proves authenticity.
  const raw = body();
  const result = verifyDiditWebhook({
    rawBody: raw,
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: null,
    signatureHeader: sign(raw),
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, true);
});

test("tolerates a sha256= prefix and uppercase hex", () => {
  const raw = body();
  const result = verifyDiditWebhook({
    rawBody: raw,
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: String(nowSeconds()),
    signatureHeader: `sha256=${sign(raw).toUpperCase()}`,
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, true);
});

test("rejects a forged signature and names the reason", () => {
  const result = verifyDiditWebhook({
    rawBody: body(),
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: String(nowSeconds()),
    signatureHeader: "a".repeat(64),
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "SIGNATURE_MISMATCH");
    assert.deepEqual(result.headersSeen, ["x-signature", "x-timestamp"]);
  }
});

test("rejects a body tampered with after signing", () => {
  const raw = body();
  const signature = sign(raw);
  const result = verifyDiditWebhook({
    rawBody: body({ status: "Declined" }),
    sessionId: SESSION,
    status: "Declined",
    webhookType: "status.updated",
    timestampHeader: String(nowSeconds()),
    signatureHeader: signature,
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
});

test("rejects a replayed request outside the 5-minute window", () => {
  const raw = body();
  const stale = String(nowSeconds() - 600);
  const result = verifyDiditWebhook({
    rawBody: raw,
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: stale,
    signatureHeader: sign(raw),
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "TIMESTAMP_EXPIRED");
});

test("reports NO_SIGNATURE_HEADER distinctly from a mismatch", () => {
  const result = verifyDiditWebhook({
    rawBody: body(),
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: String(nowSeconds()),
    signatureHeader: null,
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "NO_SIGNATURE_HEADER");
    assert.deepEqual(result.headersSeen, ["x-timestamp"]);
  }
});

test("a non-hex signature is rejected rather than throwing", () => {
  const result = verifyDiditWebhook({
    rawBody: body(),
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    timestampHeader: String(nowSeconds()),
    signatureHeader: "not-a-signature!!",
    simpleSignatureHeader: null,
    secret: SECRET,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "SIGNATURE_MISMATCH");
});
