import test from "node:test";
import assert from "node:assert/strict";
import {
  hashVerificationCode,
  generateVerificationCode,
  VERIFICATION_CODE_LENGTH,
} from "../verificationCode";

test("generateVerificationCode: always 6 digits, zero-padded", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateVerificationCode();
    assert.equal(code.length, VERIFICATION_CODE_LENGTH);
    assert.match(code, /^[0-9]{6}$/);
  }
});

test("generateVerificationCode: produces varied codes (not a constant)", () => {
  const codes = new Set(Array.from({ length: 50 }, () => generateVerificationCode()));
  assert.ok(codes.size > 1, "expected randomness across 50 generated codes");
});

test("hashVerificationCode is deterministic: same input -> same output", () => {
  const a = hashVerificationCode("123456");
  const b = hashVerificationCode("123456");
  assert.equal(a, b);
});

test("hashVerificationCode is SHA-256: output length is 64 hex chars", () => {
  const h = hashVerificationCode("000000");
  assert.equal(h.length, 64);
  assert.match(h, /^[a-f0-9]{64}$/);
});

test("hashVerificationCode: different codes produce different hashes", () => {
  const a = hashVerificationCode("111111");
  const b = hashVerificationCode("222222");
  assert.notEqual(a, b);
});

test("hashVerificationCode: never returns the raw code itself", () => {
  const code = "654321";
  const hash = hashVerificationCode(code);
  assert.notEqual(hash, code);
});
