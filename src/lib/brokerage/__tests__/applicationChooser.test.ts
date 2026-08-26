import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const SRC = "src/lib/brokerage/applicationChooser.ts";

test("exports set/get/clear cookie functions", () => {
  const source = readSrc(SRC);
  assert.ok(source.includes("export async function setApplicationChooserCookie"));
  assert.ok(source.includes("export async function getApplicationChooserIdentity"));
  assert.ok(source.includes("export async function clearApplicationChooserCookie"));
});

test("cookie payload carries both email and bankId, not email alone", () => {
  const source = readSrc(SRC);
  assert.match(source, /email.*bankId.*expiresAt|payload = `\$\{email\}:\$\{bankId\}:\$\{expiresAt\}`/);
});

test("cookie signing is delegated to the shared, tested signer", () => {
  // #900 moved HMAC-SHA256 signing and the constant-time compare out of this
  // module into chooserToken.ts. This guard used to grep THIS file for
  // "createHmac" and began failing on that refactor even though the security
  // property was intact — so it asserts delegation now, and the property
  // itself is proven behaviourally in chooserToken.test.ts (forged key,
  // tampered payload, tampered signature, malformed input).
  const source = readSrc(SRC);
  assert.match(source, /from "@\/lib\/brokerage\/chooserToken"/);
  assert.match(source, /signChooserPayload\(/);
  assert.match(source, /verifyChooserPayload\(/);
  // Signing must not be reimplemented locally: one signer, one contract.
  assert.doesNotMatch(source, /createHmac/);
});

test("cookie is httpOnly, secure, sameSite=lax, 10-minute TTL", () => {
  const source = readSrc(SRC);
  assert.ok(source.includes("httpOnly: true"));
  assert.ok(source.includes("secure: true"));
  assert.ok(source.includes('sameSite: "lax"'));
  assert.ok(source.includes("COOKIE_MAX_AGE_SECONDS = 10 * 60"));
});

test("expired tokens are rejected even with a valid signature", () => {
  const source = readSrc(SRC);
  assert.ok(source.includes("expiresAt < Math.floor(Date.now() / 1000)"));
});

test("clear sets maxAge: 0, invalidating the cookie", () => {
  const source = readSrc(SRC);
  assert.ok(source.includes("maxAge: 0"));
});

test("cookie name is distinct from the QA chooser and the real session cookie", () => {
  const source = readSrc(SRC);
  assert.ok(source.includes('"buddy_application_chooser"'));
  assert.doesNotMatch(source, /"buddy_qa_chooser"/);
  assert.doesNotMatch(source, /"buddy_borrower_session"/);
});
