import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  signChooserPayload,
  verifyChooserPayload,
} from "@/lib/brokerage/chooserToken";

const KEY = "unit-test-chooser-key-with-sufficient-entropy";

test("chooser token round-trips an authenticated payload", () => {
  const payload = "borrower@example.com:bank-123:1893456000";
  const token = signChooserPayload(payload, KEY);

  assert.equal(verifyChooserPayload(token, KEY), payload);
});

test("chooser token rejects payload and signature tampering", () => {
  const token = signChooserPayload("borrower@example.com:1893456000", KEY);
  const [payload, signature] = token.split(".");

  assert.equal(
    verifyChooserPayload(`${payload}x.${signature}`, KEY),
    null,
  );
  const tamperedSignature =
    signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
  assert.equal(
    verifyChooserPayload(`${payload}.${tamperedSignature}`, KEY),
    null,
  );
  assert.equal(
    verifyChooserPayload(token, "different-key"),
    null,
  );
});

test("malformed attacker-controlled signatures fail closed without throwing", () => {
  const payload = Buffer.from("borrower@example.com:1893456000").toString("base64url");

  for (const token of [
    "",
    "no-dot",
    `${payload}.`,
    `${payload}.0`,
    `${payload}.${"0".repeat(63)}`,
    `${payload}.${"0".repeat(65)}`,
    `${payload}.${"z".repeat(64)}`,
    `%%%.${"0".repeat(64)}`,
  ]) {
    assert.doesNotThrow(() => verifyChooserPayload(token, KEY));
    assert.equal(verifyChooserPayload(token, KEY), null);
  }
});

test("chooser modules share the hardened key and token boundary", () => {
  for (const path of [
    "src/lib/brokerage/qaChooser.ts",
    "src/lib/brokerage/applicationChooser.ts",
  ]) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    assert.match(source, /getChooserSigningKey/);
    assert.match(source, /signChooserPayload/);
    assert.match(source, /verifyChooserPayload/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.doesNotMatch(source, /createHmac/);
  }
});

test("production key resolution never accepts a public key or committed fallback", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/brokerage/chooserSigningKey.ts"),
    "utf8",
  );

  assert.match(source, /BORROWER_CHOOSER_SIGNING_SECRET/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
  assert.match(source, /NODE_ENV !== "production"/);
  assert.match(source, /throw new Error/);
});
