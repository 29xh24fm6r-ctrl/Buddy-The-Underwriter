/**
 * SPEC-CHECKLIST-DOCUMENT-SATISFACTION-RECONCILIATION-1 — Required test #1.
 *
 * Both the long form (PERSONAL_FINANCIAL_STATEMENT) and the short canonical
 * type the AI classifier actually stamps (PFS) must resolve to PFS_CURRENT.
 * The missing PFS alias is what left a valid finalized PFS document without a
 * checklist_key, pinning the required item at status=missing.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { resolveChecklistKey } from "../resolveChecklistKey";

describe("resolveChecklistKey PFS mapping", () => {
  test("PFS resolves to PFS_CURRENT", () => {
    assert.equal(resolveChecklistKey("PFS", null), "PFS_CURRENT");
  });

  test("PFS resolves to PFS_CURRENT regardless of tax year / statement period", () => {
    assert.equal(resolveChecklistKey("PFS", 2026), "PFS_CURRENT");
    assert.equal(resolveChecklistKey("PFS", null, "CURRENT"), "PFS_CURRENT");
  });

  test("PERSONAL_FINANCIAL_STATEMENT still resolves to PFS_CURRENT (back-compat)", () => {
    assert.equal(
      resolveChecklistKey("PERSONAL_FINANCIAL_STATEMENT", null),
      "PFS_CURRENT",
    );
  });

  test("unrelated canonical types are unaffected", () => {
    assert.equal(resolveChecklistKey("RENT_ROLL", null), "RENT_ROLL");
    assert.equal(resolveChecklistKey("UNKNOWN_TYPE", null), null);
  });
});
