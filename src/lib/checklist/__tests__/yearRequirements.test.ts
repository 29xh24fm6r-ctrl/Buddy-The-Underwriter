import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isTaxYearRequired,
  YEAR_REQUIRED_KEYS,
  CHECKLIST_KEY_OPTIONS,
} from "../checklistKeyOptions";

// ---------------------------------------------------------------------------
// Suite 1: isTaxYearRequired
// ---------------------------------------------------------------------------

describe("isTaxYearRequired", () => {
  it("returns true for IRS_BUSINESS_3Y", () => {
    assert.equal(isTaxYearRequired("IRS_BUSINESS_3Y"), true);
  });

  it("returns true for IRS_BUSINESS_2Y", () => {
    assert.equal(isTaxYearRequired("IRS_BUSINESS_2Y"), true);
  });

  it("returns true for IRS_PERSONAL_3Y", () => {
    assert.equal(isTaxYearRequired("IRS_PERSONAL_3Y"), true);
  });

  it("returns true for IRS_PERSONAL_2Y", () => {
    assert.equal(isTaxYearRequired("IRS_PERSONAL_2Y"), true);
  });

  it("returns false for PFS_CURRENT", () => {
    assert.equal(isTaxYearRequired("PFS_CURRENT"), false);
  });

  it("returns false for RENT_ROLL", () => {
    assert.equal(isTaxYearRequired("RENT_ROLL"), false);
  });

  it("returns false for K1 (tax category but not year-based)", () => {
    assert.equal(isTaxYearRequired("K1"), false);
  });

  it("returns false for null", () => {
    assert.equal(isTaxYearRequired(null), false);
  });

  it("returns false for undefined", () => {
    assert.equal(isTaxYearRequired(undefined), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isTaxYearRequired(""), false);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: YEAR_REQUIRED_KEYS
// ---------------------------------------------------------------------------

describe("YEAR_REQUIRED_KEYS", () => {
  it("contains exactly 4 keys", () => {
    assert.equal(YEAR_REQUIRED_KEYS.size, 4);
  });

  it("all keys exist in CHECKLIST_KEY_OPTIONS", () => {
    const allKeys = new Set(CHECKLIST_KEY_OPTIONS.map((o) => o.key));
    for (const key of YEAR_REQUIRED_KEYS) {
      assert.ok(allKeys.has(key), `${key} not found in CHECKLIST_KEY_OPTIONS`);
    }
  });

  it("only includes keys with requiresTaxYear: true", () => {
    const yearKeys = CHECKLIST_KEY_OPTIONS
      .filter((o) => o.requiresTaxYear)
      .map((o) => o.key);
    assert.deepEqual(
      new Set(yearKeys),
      YEAR_REQUIRED_KEYS,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Owner scope (design documentation guard)
// ---------------------------------------------------------------------------

describe("owner scope (design documentation)", () => {
  it("all CHECKLIST_KEY_OPTIONS keys are unique (no per-owner variants)", () => {
    const keys = CHECKLIST_KEY_OPTIONS.map((o) => o.key);
    const unique = new Set(keys);
    assert.equal(keys.length, unique.size, "Duplicate checklist keys found");
  });
});
