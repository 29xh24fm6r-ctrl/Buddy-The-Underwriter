/**
 * SPEC-PFS-CANONICAL-TYPE-ALIAS-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIRMED_SRC = readFileSync(
  resolve(__dirname, "../processing/processConfirmedIntake.ts"), "utf-8",
);
const SLOTS_SRC = readFileSync(
  resolve(__dirname, "../slots/ensureCoreDocumentSlots.ts"), "utf-8",
);
const ALIAS_SRC = readFileSync(
  resolve(__dirname, "../canonicalTypeAliases.ts"), "utf-8",
);

describe("SPEC-PFS-CANONICAL-TYPE-ALIAS-1 guards", () => {
  test("EXTRACT_ELIGIBLE contains PFS", () => {
    assert.ok(CONFIRMED_SRC.includes('"PFS"'));
  });

  test("EXTRACT_ELIGIBLE contains PERSONAL_FINANCIAL_STATEMENT", () => {
    assert.ok(CONFIRMED_SRC.includes('"PERSONAL_FINANCIAL_STATEMENT"'));
  });

  test("PFS_CURRENT slot required_doc_type is PFS", () => {
    assert.ok(
      SLOTS_SRC.includes('required_doc_type: "PFS"'),
      "PFS_CURRENT slot must use 'PFS' to match classifier output",
    );
  });

  test("isPfsDoc helper exported from canonicalTypeAliases.ts", () => {
    assert.ok(ALIAS_SRC.includes("export function isPfsDoc"));
  });

  test("buildCoreSlotDefinitions includes AR_AGING_CURRENT slot", () => {
    assert.ok(SLOTS_SRC.includes('"AR_AGING_CURRENT"'));
  });

  test("AR_AGING_CURRENT slot has required: false", () => {
    const arIdx = SLOTS_SRC.indexOf("AR_AGING_CURRENT");
    const reqIdx = SLOTS_SRC.indexOf("required: false", arIdx);
    assert.ok(arIdx > 0 && reqIdx > 0 && reqIdx - arIdx < 150,
      "AR_AGING_CURRENT must be optional (required: false)");
  });
});
