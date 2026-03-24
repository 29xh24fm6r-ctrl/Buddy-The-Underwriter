/**
 * Pure-logic tests for bank selection error classification.
 *
 * Run: npx tsx src/lib/tenant/__tests__/bankSelectErrors.test.ts
 */

import assert from "node:assert/strict";
import { classifyBankSelectError } from "../bankSelectErrors";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e: any) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

const ctx = { bankId: "bank-123" };

// ─── classifyBankSelectError ──────────────────────────────────────────────

console.log("bankSelectErrors — classifyBankSelectError");

test("23503 foreign key violation → bank_not_found (404)", () => {
  const result = classifyBankSelectError(
    { code: "23503", message: "violates foreign key constraint" },
    ctx,
  );
  assert.equal(result.error, "bank_not_found");
  assert.equal(result.status, 404);
});

test("foreign key in message without pgCode → bank_not_found", () => {
  const result = classifyBankSelectError(
    { message: "violates foreign key" },
    ctx,
  );
  assert.equal(result.error, "bank_not_found");
  assert.equal(result.status, 404);
});

test("23505 duplicate key → membership_create_failed (409)", () => {
  const result = classifyBankSelectError(
    { code: "23505", message: "duplicate key value violates unique constraint" },
    ctx,
  );
  assert.equal(result.error, "membership_create_failed");
  assert.equal(result.status, 409);
});

test("duplicate in message without pgCode → membership_create_failed", () => {
  const result = classifyBankSelectError(
    { message: "duplicate key" },
    ctx,
  );
  assert.equal(result.error, "membership_create_failed");
  assert.equal(result.status, 409);
});

test("unique constraint in message → membership_create_failed", () => {
  const result = classifyBankSelectError(
    { message: "unique constraint violated" },
    ctx,
  );
  assert.equal(result.error, "membership_create_failed");
});

test("trigger: user_id required → profile_setup_failed (500)", () => {
  const result = classifyBankSelectError(
    { message: "bank_memberships.user_id required: provide user_id" },
    ctx,
  );
  assert.equal(result.error, "profile_setup_failed");
  assert.equal(result.status, 500);
});

test("trigger: bank_memberships.user_id → profile_setup_failed", () => {
  const result = classifyBankSelectError(
    { message: "ERROR: bank_memberships.user_id cannot be null" },
    ctx,
  );
  assert.equal(result.error, "profile_setup_failed");
});

test("unknown error → activation_failed (500)", () => {
  const result = classifyBankSelectError(
    { code: "42601", message: "syntax error" },
    ctx,
  );
  assert.equal(result.error, "activation_failed");
  assert.equal(result.status, 500);
});

test("empty error → activation_failed (500)", () => {
  const result = classifyBankSelectError({}, ctx);
  assert.equal(result.error, "activation_failed");
  assert.equal(result.status, 500);
});

test("null-ish message → activation_failed (500)", () => {
  const result = classifyBankSelectError(
    { code: undefined, message: undefined },
    ctx,
  );
  assert.equal(result.error, "activation_failed");
  assert.equal(result.status, 500);
});

test("all results include non-empty detail string", () => {
  const cases = [
    { code: "23503", message: "foreign key" },
    { code: "23505", message: "duplicate key" },
    { message: "user_id required" },
    { message: "something else" },
    {},
  ];
  for (const err of cases) {
    const result = classifyBankSelectError(err, ctx);
    assert.ok(typeof result.detail === "string" && result.detail.length > 0);
  }
});

// ─── Type safety ──────────────────────────────────────────────────────────

console.log("bankSelectErrors — type safety");

test("all five error codes are representable", () => {
  const codes: import("../bankSelectErrors").BankSelectError[] = [
    "bank_not_found",
    "bank_is_sandbox",
    "profile_setup_failed",
    "membership_create_failed",
    "activation_failed",
  ];
  assert.equal(codes.length, 5);
  for (const c of codes) {
    assert.ok(typeof c === "string");
  }
});

test("all statuses are valid HTTP codes (400-599)", () => {
  const cases = [
    { code: "23503", message: "foreign key" },
    { code: "23505", message: "duplicate" },
    { message: "user_id required" },
    {},
  ];
  for (const err of cases) {
    const result = classifyBankSelectError(err, ctx);
    assert.ok(result.status >= 400 && result.status < 600);
  }
});

console.log("\nAll bankSelectErrors tests complete.");
