import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();

const { verifyDiditWebhook } = require("@/lib/identity/kyc/verifyDiditWebhook") as typeof import("@/lib/identity/kyc/verifyDiditWebhook");

const SECRET = "whsec_test_secret";
const SESSION = "252f29e1-5d22-4743-a44d-71042bcd0389";
const NOW_MS = 1_770_000_000_000;
const NOW_SECONDS = String(NOW_MS / 1000);

function body(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    session_id: SESSION,
    status: "Approved",
    webhook_type: "status.updated",
    timestamp: Number(NOW_SECONDS),
    ...overrides,
  });
}

function sign(data: string) {
  return createHmac("sha256", SECRET).update(data, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      const record = input as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((out, key) => {
          out[key] = sort(record[key]);
          return out;
        }, {});
    }
    return input;
  }
  const encoded = JSON.stringify(sort(value));
  if (encoded === undefined) throw new Error("didit_webhook_canonicalization_failed");
  return encoded;
}

type VerifyParams = Parameters<typeof verifyDiditWebhook>[0];

function verify(overrides: Partial<VerifyParams>): ReturnType<typeof verifyDiditWebhook> {
  const rawBody = overrides.rawBody ?? body();
  return verifyDiditWebhook({
    rawBody,
    sessionId: SESSION,
    status: "Approved",
    webhookType: "status.updated",
    payloadTimestamp: Number(NOW_SECONDS),
    timestampHeader: NOW_SECONDS,
    signatureV2Header: null,
    signatureHeader: sign(rawBody),
    simpleSignatureHeader: null,
    secret: SECRET,
    nowMs: NOW_MS,
    ...overrides,
  });
}

test("accepts Didit's recommended X-Signature-V2 over recursively canonical JSON", () => {
  const rawBody = JSON.stringify({
    webhook_type: "status.updated",
    status: "Approved",
    session_id: SESSION,
    timestamp: Number(NOW_SECONDS),
    decision: {
      name: "José",
      nested: { z: 1, a: [{ y: true, x: "✓" }] },
    },
  });
  const result = verify({
    rawBody,
    signatureV2Header: sign(canonicalize(JSON.parse(rawBody))),
    signatureHeader: null,
  });
  assert.deepEqual(result, { ok: true, scheme: "v2" });
});

test("V2 canonicalization preserves empty objects and array order", () => {
  const rawBody = JSON.stringify({
    status: "Approved",
    webhook_type: "status.updated",
    session_id: SESSION,
    timestamp: Number(NOW_SECONDS),
    decision: { empty: {}, values: [{ b: 2, a: 1 }, 3, 2, 1] },
  });
  const result = verify({
    rawBody,
    signatureV2Header: sign(canonicalize(JSON.parse(rawBody))),
    signatureHeader: null,
  });
  assert.deepEqual(result, { ok: true, scheme: "v2" });
});

test("accepts Didit's exact raw-body X-Signature fallback", () => {
  const rawBody = body();
  const result = verify({ rawBody, signatureHeader: sign(rawBody) });
  assert.deepEqual(result, { ok: true, scheme: "raw_body" });
});

test("accepts the envelope-only X-Signature-Simple fallback", () => {
  const payloadTimestamp = Number(NOW_SECONDS);
  const result = verify({
    signatureHeader: null,
    simpleSignatureHeader: sign(`${payloadTimestamp}:${SESSION}:Approved:status.updated`),
  });
  assert.deepEqual(result, { ok: true, scheme: "simple" });
});

test("requires X-Timestamp even when the raw-body signature is authentic", () => {
  const rawBody = body();
  const result = verify({
    rawBody,
    timestampHeader: null,
    signatureHeader: sign(rawBody),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "TIMESTAMP_MISSING");
});

test("requires X-Timestamp even when the V2 signature is authentic", () => {
  const rawBody = body();
  const result = verify({
    rawBody,
    timestampHeader: null,
    signatureV2Header: sign(canonicalize(JSON.parse(rawBody))),
    signatureHeader: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "TIMESTAMP_MISSING");
});

test("rejects malformed and non-integer timestamp headers", () => {
  for (const timestampHeader of ["not-a-time", "1770000000.5", "Infinity"]) {
    const result = verify({ timestampHeader });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "TIMESTAMP_INVALID");
  }
});

test("rejects a replayed request outside the five-minute window", () => {
  const staleTimestamp = String(Number(NOW_SECONDS) - 301);
  const rawBody = body({ timestamp: Number(staleTimestamp) });
  const result = verify({
    rawBody,
    payloadTimestamp: Number(staleTimestamp),
    timestampHeader: staleTimestamp,
    signatureHeader: sign(rawBody),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "TIMESTAMP_EXPIRED");
});

test("accepts a delivery exactly at the five-minute boundary", () => {
  const boundaryTimestamp = String(Number(NOW_SECONDS) - 300);
  const rawBody = body({ timestamp: Number(boundaryTimestamp) });
  const result = verify({
    rawBody,
    payloadTimestamp: Number(boundaryTimestamp),
    timestampHeader: boundaryTimestamp,
    signatureHeader: sign(rawBody),
  });
  assert.deepEqual(result, { ok: true, scheme: "raw_body" });
});

test("rejects a forged signature and reports every header seen", () => {
  const result = verify({
    signatureV2Header: "a".repeat(64),
    signatureHeader: "b".repeat(64),
    simpleSignatureHeader: "c".repeat(64),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "SIGNATURE_MISMATCH");
    assert.deepEqual(result.headersSeen, [
      "x-signature-v2",
      "x-signature",
      "x-signature-simple",
      "x-timestamp",
    ]);
  }
});

test("rejects a body tampered with after V2 signing", () => {
  const original = body();
  const result = verify({
    rawBody: body({ status: "Declined" }),
    status: "Declined",
    signatureV2Header: sign(canonicalize(JSON.parse(original))),
    signatureHeader: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "SIGNATURE_MISMATCH");
});

test("reports missing signatures distinctly from timestamp failures", () => {
  const result = verify({
    signatureV2Header: null,
    signatureHeader: null,
    simpleSignatureHeader: null,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "NO_SIGNATURE_HEADER");
    assert.deepEqual(result.headersSeen, ["x-timestamp"]);
  }
});

test("a non-hex signature is rejected rather than throwing", () => {
  const result = verify({ signatureHeader: "not-a-signature!!" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "SIGNATURE_MISMATCH");
});

test("tolerates a sha256= prefix and uppercase hex", () => {
  const rawBody = body();
  const result = verify({
    rawBody,
    signatureHeader: `sha256=${sign(rawBody).toUpperCase()}`,
  });
  assert.deepEqual(result, { ok: true, scheme: "raw_body" });
});
