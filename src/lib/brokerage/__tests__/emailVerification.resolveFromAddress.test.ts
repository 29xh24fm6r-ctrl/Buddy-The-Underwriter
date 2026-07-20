import { test, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * Regression coverage for the 2026-07-20 production incident: EMAIL_FROM
 * was set to a value Resend rejected as malformed ("Invalid `from` field"),
 * which hard-failed every OTP send on /start with no actionable signal.
 * resolveFromAddress() now validates the configured value before it ever
 * reaches the provider, falling back to a known-good default instead.
 */
let resolveFromAddress: typeof import("../emailVerification").resolveFromAddress;

before(async () => {
  mockServerOnly();
  ({ resolveFromAddress } = await import("../emailVerification"));
});

const ORIGINAL = process.env.EMAIL_FROM;

beforeEach(() => {
  delete process.env.EMAIL_FROM;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = ORIGINAL;
});

test("resolveFromAddress: unset EMAIL_FROM -> safe default", () => {
  assert.equal(resolveFromAddress(), "noreply@buddy.com");
});

test("resolveFromAddress: malformed EMAIL_FROM (no TLD) -> falls back to safe default", () => {
  process.env.EMAIL_FROM = "buddy@localhost";
  assert.equal(resolveFromAddress(), "noreply@buddy.com");
});

test("resolveFromAddress: empty-string EMAIL_FROM -> falls back to safe default", () => {
  process.env.EMAIL_FROM = "";
  assert.equal(resolveFromAddress(), "noreply@buddy.com");
});

test("resolveFromAddress: valid plain email -> used as-is", () => {
  process.env.EMAIL_FROM = "underwriting@buddytheunderwriter.com";
  assert.equal(resolveFromAddress(), "underwriting@buddytheunderwriter.com");
});

test("resolveFromAddress: valid 'Name <email>' format -> used as-is", () => {
  process.env.EMAIL_FROM = "Buddy <noreply@buddy.app>";
  assert.equal(resolveFromAddress(), "Buddy <noreply@buddy.app>");
});

test("resolveFromAddress: valid value with surrounding whitespace -> trimmed", () => {
  process.env.EMAIL_FROM = "  noreply@buddy.app  ";
  assert.equal(resolveFromAddress(), "noreply@buddy.app");
});
