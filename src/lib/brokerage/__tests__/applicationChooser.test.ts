import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const SRC = "src/lib/brokerage/applicationChooser.ts";
const TOKEN_SRC = "src/lib/brokerage/chooserToken.ts";
const SIGNING_KEY_SRC = "src/lib/brokerage/chooserSigningKey.ts";

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

test("cookie delegates to the centralized HMAC-SHA256 signer", () => {
  const source = readSrc(SRC);
  const tokenSource = readSrc(TOKEN_SRC);
  const keySource = readSrc(SIGNING_KEY_SRC);

  assert.ok(source.includes("signChooserPayload"));
  assert.ok(source.includes("verifyChooserPayload"));
  assert.ok(tokenSource.includes("createHmac"));
  assert.ok(tokenSource.includes("sha256"));
  assert.ok(tokenSource.includes("timingSafeEqual"));
  assert.doesNotMatch(keySource, /process\.env\.NEXT_PUBLIC_/);
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
  assert.match(source, /const COOKIE_NAME = "buddy_application_chooser"/);
  assert.doesNotMatch(source, /const COOKIE_NAME = "buddy_qa_chooser"/);
  assert.doesNotMatch(source, /const COOKIE_NAME = "buddy_borrower_session"/);
});
