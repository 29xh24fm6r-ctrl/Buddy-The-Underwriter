import { test } from "node:test";
import assert from "node:assert/strict";
import { integerToWords, amountToWords } from "@/lib/sba/forms/numberToWords";

test("integerToWords: zero", () => {
  assert.equal(integerToWords(0), "Zero");
});

test("integerToWords: single digit", () => {
  assert.equal(integerToWords(7), "Seven");
});

test("integerToWords: teens", () => {
  assert.equal(integerToWords(13), "Thirteen");
});

test("integerToWords: tens with ones", () => {
  assert.equal(integerToWords(42), "Forty-Two");
});

test("integerToWords: exact tens", () => {
  assert.equal(integerToWords(90), "Ninety");
});

test("integerToWords: hundreds", () => {
  assert.equal(integerToWords(123), "One Hundred Twenty-Three");
});

test("integerToWords: thousands", () => {
  assert.equal(integerToWords(100_000), "One Hundred Thousand");
});

test("integerToWords: mixed groups with internal zero group", () => {
  // 1,000,234 has a zero thousands-group that must be skipped, not rendered as "Zero Thousand"
  assert.equal(integerToWords(1_000_234), "One Million, Two Hundred Thirty-Four");
});

test("integerToWords: full mixed number", () => {
  assert.equal(integerToWords(1_234_567), "One Million, Two Hundred Thirty-Four Thousand, Five Hundred Sixty-Seven");
});

test("integerToWords: too large throws rather than truncating silently", () => {
  assert.throws(() => integerToWords(10 ** 18));
});

test("amountToWords: whole dollar amount", () => {
  assert.equal(amountToWords(100_000), "One Hundred Thousand and 00/100");
});

test("amountToWords: with cents", () => {
  assert.equal(amountToWords(1_234.5), "One Thousand, Two Hundred Thirty-Four and 50/100");
});

test("amountToWords: rounds sub-cent floating point noise", () => {
  assert.equal(amountToWords(19.999999), "Twenty and 00/100");
});

test("amountToWords: single-digit cents padded to two digits", () => {
  assert.equal(amountToWords(5.07), "Five and 07/100");
});
