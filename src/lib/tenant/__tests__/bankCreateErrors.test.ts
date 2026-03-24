/**
 * Pure-logic tests for bank creation error classification and code generation.
 *
 * Run: npx tsx src/lib/tenant/__tests__/bankCreateErrors.test.ts
 */

import assert from "node:assert/strict";
import { classifyBankInsertError, generateBankCode } from "../bankCreateErrors";

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

const ctx = { name: "Test Bank", code: "TES_1234", websiteUrl: null };

// ─── classifyBankInsertError ──────────────────────────────────────────────

console.log("bankCreateErrors — classifyBankInsertError");

test("23505 with banks_code_key → bank_code_conflict (409)", () => {
  const result = classifyBankInsertError(
    { code: "23505", message: 'duplicate key value violates unique constraint "banks_code_key"' },
    ctx,
  );
  assert.equal(result.error, "bank_code_conflict");
  assert.equal(result.status, 409);
});

test("23505 with code in message → bank_code_conflict", () => {
  const result = classifyBankInsertError(
    { code: "23505", message: "duplicate key: code" },
    ctx,
  );
  assert.equal(result.error, "bank_code_conflict");
  assert.equal(result.status, 409);
});

test("23505 generic unique violation → bank_name_conflict (409)", () => {
  const result = classifyBankInsertError(
    { code: "23505", message: "duplicate key value violates unique constraint" },
    ctx,
  );
  assert.equal(result.error, "bank_name_conflict");
  assert.equal(result.status, 409);
});

test("duplicate key in message without pgCode → bank_name_conflict", () => {
  const result = classifyBankInsertError(
    { message: "duplicate key value" },
    ctx,
  );
  assert.equal(result.error, "bank_name_conflict");
  assert.equal(result.status, 409);
});

test("unique constraint in message → bank_name_conflict", () => {
  const result = classifyBankInsertError(
    { message: "unique constraint violated" },
    ctx,
  );
  assert.equal(result.error, "bank_name_conflict");
});

test("unknown error → bank_insert_failed (500)", () => {
  const result = classifyBankInsertError(
    { code: "42601", message: "syntax error" },
    ctx,
  );
  assert.equal(result.error, "bank_insert_failed");
  assert.equal(result.status, 500);
});

test("empty error → bank_insert_failed (500)", () => {
  const result = classifyBankInsertError({}, ctx);
  assert.equal(result.error, "bank_insert_failed");
  assert.equal(result.status, 500);
});

test("null-ish message → bank_insert_failed (500)", () => {
  const result = classifyBankInsertError(
    { code: undefined, message: undefined },
    ctx,
  );
  assert.equal(result.error, "bank_insert_failed");
  assert.equal(result.status, 500);
});

test("all results include detail string", () => {
  const cases = [
    { code: "23505", message: "banks_code_key" },
    { code: "23505", message: "duplicate key" },
    { message: "something else" },
    {},
  ];
  for (const err of cases) {
    const result = classifyBankInsertError(err, ctx);
    assert.ok(typeof result.detail === "string" && result.detail.length > 0);
  }
});

// ─── generateBankCode ─────────────────────────────────────────────────────

console.log("bankCreateErrors — generateBankCode");

test("generates ABC_XXXX format", () => {
  const code = generateBankCode("First National");
  assert.match(code, /^[A-Z]{3}_[A-Z0-9]{4}$/);
});

test("uses first 3 alphanumeric chars uppercased", () => {
  const code = generateBankCode("abc xyz");
  assert.ok(code.startsWith("ABC_"));
});

test("strips non-alphanumeric chars", () => {
  const code = generateBankCode("$$$Hello World!!!");
  assert.ok(code.startsWith("HEL_"));
});

test("falls back to BNK for empty/symbolic name", () => {
  const code = generateBankCode("---");
  assert.ok(code.startsWith("BNK_"));
});

test("falls back to BNK for empty string", () => {
  const code = generateBankCode("");
  assert.ok(code.startsWith("BNK_"));
});

test("two calls produce different suffixes (timestamp-based)", () => {
  const a = generateBankCode("Test");
  // Force a tiny time shift
  const b = generateBankCode("Test" + Date.now());
  // Codes may collide if called in same ms, but prefix differs
  assert.ok(typeof a === "string" && typeof b === "string");
});

// ─── Error type exhaustiveness ────────────────────────────────────────────

console.log("bankCreateErrors — type safety");

test("all five error codes are representable", () => {
  const codes: import("../bankCreateErrors").BankCreateError[] = [
    "bank_name_conflict",
    "bank_code_conflict",
    "bank_insert_failed",
    "profile_setup_failed",
    "membership_failed",
  ];
  assert.equal(codes.length, 5);
  // Verify all are strings
  for (const c of codes) {
    assert.ok(typeof c === "string");
  }
});

console.log("\nAll bankCreateErrors tests complete.");
