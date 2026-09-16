import assert from "node:assert/strict";
import test from "node:test";

import {
  formatUsPhoneInput,
  formatUsdInput,
  parseUsdInput,
  phoneDigits,
} from "../leadFieldFormatting";

test("formats a ten-digit US phone number", () => {
  assert.equal(formatUsPhoneInput("8285773337"), "(828) 577-3337");
  assert.equal(formatUsPhoneInput("(828) 577-3337"), "(828) 577-3337");
  assert.equal(formatUsPhoneInput("1-828-577-3337"), "(828) 577-3337");
});

test("formats phone input progressively and keeps canonical digits", () => {
  assert.equal(formatUsPhoneInput("8285"), "(828) 5");
  assert.equal(phoneDigits("(828) 577-3337"), "8285773337");
});

test("formats and parses whole-dollar requested amounts", () => {
  assert.equal(formatUsdInput("700000"), "$700,000");
  assert.equal(formatUsdInput("$700,000"), "$700,000");
  assert.equal(formatUsdInput(""), "");
  assert.equal(parseUsdInput("$700,000"), 700000);
  assert.equal(parseUsdInput(""), undefined);
});
