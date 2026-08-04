/**
 * Unit tests for QA borrower identity configuration.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §6, §9
 *
 * Proves:
 *  - Production startup fails if test bypass is enabled
 *  - staging OTP only works under all required conditions
 *  - QA email matching works correctly
 *  - Universal code does not work
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const {
  isQABorrowerEmail,
  getQABorrowerEmail,
  assertQATestAuthSafety,
  canUseDeterministicOtp,
  validateDeterministicOtp,
} = require("../config") as typeof import("../config");

// Save and restore env for each test
let savedEnv: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) {
    savedEnv[k] = process.env[k];
  }
}

function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
}

test("isQABorrowerEmail matches configured QA email", () => {
  saveEnv("BORROWER_QA_EMAIL");
  process.env.BORROWER_QA_EMAIL = "qa-borrower@example.com";

  assert.equal(isQABorrowerEmail("qa-borrower@example.com"), true);
  assert.equal(isQABorrowerEmail("QA-BORROWER@example.com"), true);
  assert.equal(isQABorrowerEmail("qa-borrower@EXAMPLE.COM"), true);
  assert.equal(isQABorrowerEmail("other@example.com"), false);
  assert.equal(isQABorrowerEmail(""), false);

  restoreEnv("BORROWER_QA_EMAIL");
});

test("isQABorrowerEmail returns false when QA email is not configured", () => {
  saveEnv("BORROWER_QA_EMAIL");
  delete process.env.BORROWER_QA_EMAIL;

  assert.equal(isQABorrowerEmail("qa-borrower@example.com"), false);
  assert.equal(isQABorrowerEmail(""), false);

  restoreEnv("BORROWER_QA_EMAIL");
});

test("getQABorrowerEmail returns null when not configured", () => {
  saveEnv("BORROWER_QA_EMAIL");
  delete process.env.BORROWER_QA_EMAIL;

  assert.equal(getQABorrowerEmail(), null);

  restoreEnv("BORROWER_QA_EMAIL");
});

test("assertQATestAuthSafety throws when BORROWER_TEST_AUTH_ENABLED=true in production", () => {
  saveEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED");
  process.env.NODE_ENV = "production";
  process.env.BORROWER_TEST_AUTH_ENABLED = "true";

  assert.throws(
    () => assertQATestAuthSafety(),
    /BORROWER_TEST_AUTH_ENABLED=true in production/,
  );

  restoreEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED");
});

test("assertQATestAuthSafety throws when BORROWER_TEST_OTP is set in production", () => {
  saveEnv("NODE_ENV", "BORROWER_TEST_OTP", "BORROWER_TEST_AUTH_ENABLED");
  process.env.NODE_ENV = "production";
  process.env.BORROWER_TEST_AUTH_ENABLED = "false";
  process.env.BORROWER_TEST_OTP = "123456";

  assert.throws(
    () => assertQATestAuthSafety(),
    /BORROWER_TEST_OTP is configured in production/,
  );

  restoreEnv("NODE_ENV", "BORROWER_TEST_OTP", "BORROWER_TEST_AUTH_ENABLED");
});

test("assertQATestAuthSafety does not throw in production without test bypass", () => {
  saveEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");
  process.env.NODE_ENV = "production";
  process.env.BORROWER_TEST_AUTH_ENABLED = "false";
  delete process.env.BORROWER_TEST_OTP;

  assert.doesNotThrow(() => assertQATestAuthSafety());

  restoreEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");
});

test("canUseDeterministicOtp returns true only when all conditions are met", () => {
  saveEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");

  // NOT production, enabled, OTP present
  process.env.NODE_ENV = "development";
  process.env.BORROWER_TEST_AUTH_ENABLED = "true";
  process.env.BORROWER_TEST_OTP = "123456";
  assert.equal(canUseDeterministicOtp(), true);

  // production → false
  process.env.NODE_ENV = "production";
  assert.equal(canUseDeterministicOtp(), false);

  // development but not enabled → false
  process.env.NODE_ENV = "development";
  process.env.BORROWER_TEST_AUTH_ENABLED = "false";
  assert.equal(canUseDeterministicOtp(), false);

  // development, enabled, but no OTP → false
  process.env.BORROWER_TEST_AUTH_ENABLED = "true";
  delete process.env.BORROWER_TEST_OTP;
  assert.equal(canUseDeterministicOtp(), false);

  restoreEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");
});

test("validateDeterministicOtp only matches when all conditions hold and code matches", () => {
  saveEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");

  process.env.NODE_ENV = "development";
  process.env.BORROWER_TEST_AUTH_ENABLED = "true";
  process.env.BORROWER_TEST_OTP = "999999";

  assert.equal(validateDeterministicOtp("999999"), true);
  assert.equal(validateDeterministicOtp("000000"), false);
  assert.equal(validateDeterministicOtp(""), false);

  // In production, deterministic OTP never validates
  process.env.NODE_ENV = "production";
  assert.equal(validateDeterministicOtp("999999"), false);

  restoreEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");
});

test("universal code does not work (no magic number, no bypass)", () => {
  saveEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");

  process.env.NODE_ENV = "development";
  process.env.BORROWER_TEST_AUTH_ENABLED = "true";
  process.env.BORROWER_TEST_OTP = "999999";

  assert.equal(validateDeterministicOtp("000000"), false);
  assert.equal(validateDeterministicOtp("123456"), false);
  assert.equal(validateDeterministicOtp("999999"), true);

  // No universal/backdoor codes
  assert.equal(validateDeterministicOtp("letmein"), false);
  assert.equal(validateDeterministicOtp("admin"), false);
  assert.equal(validateDeterministicOtp("bypass"), false);
  assert.equal(validateDeterministicOtp("BORROWER_TEST_OTP"), false);

  restoreEnv("NODE_ENV", "BORROWER_TEST_AUTH_ENABLED", "BORROWER_TEST_OTP");
});
