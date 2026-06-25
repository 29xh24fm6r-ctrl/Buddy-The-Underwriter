/**
 * SPEC-CHECKLIST-DOCUMENT-SATISFACTION-RECONCILIATION-1 — Required tests #2/#3/#4.
 *
 * The deterministic satisfaction decision lives in the pure docValidity module
 * (engine.ts pulls server-only deps and can't be imported under node:test). These
 * tests pin the exact semantics the reconcile loop relies on:
 *   #2/#3 — a valid active, quality-passed PFS doc with canonical_type=PFS and
 *           checklist_key=null satisfies PFS_CURRENT.
 *   #4    — inactive / failed-quality / wrong-type docs never satisfy.
 *
 * The Omnicare-shaped document is used verbatim as the positive fixture.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  isDocValidForChecklistKey,
  isDocActiveAndQualityOk,
  docMatchesChecklistKey,
} from "../docValidity";

// Omnicare HUNT PFS 2026.pdf — exactly as observed in the deal.
const OMNICARE_PFS = {
  id: "5ca84ff0-3c39-43a8-b66b-d803bcfa966a",
  canonical_type: "PFS",
  document_type: "PFS",
  checklist_key: null,
  quality_status: "PASSED",
  is_active: true,
  finalized_at: "2026-06-18",
};

describe("PFS_CURRENT satisfaction validity", () => {
  test("#2/#3 active, quality-passed PFS (canonical_type=PFS, checklist_key=null) satisfies PFS_CURRENT", () => {
    assert.equal(docMatchesChecklistKey(OMNICARE_PFS, "PFS_CURRENT"), true);
    assert.equal(isDocActiveAndQualityOk(OMNICARE_PFS), true);
    assert.equal(isDocValidForChecklistKey(OMNICARE_PFS, "PFS_CURRENT"), true);
  });

  test("#3 PFS with only document_type (no canonical_type) still matches", () => {
    const doc = { ...OMNICARE_PFS, canonical_type: null, document_type: "PFS" };
    assert.equal(isDocValidForChecklistKey(doc, "PFS_CURRENT"), true);
  });

  test("long-form PERSONAL_FINANCIAL_STATEMENT canonical_type matches", () => {
    const doc = { ...OMNICARE_PFS, canonical_type: "PERSONAL_FINANCIAL_STATEMENT" };
    assert.equal(isDocValidForChecklistKey(doc, "PFS_CURRENT"), true);
  });

  test("#4 inactive doc does NOT satisfy", () => {
    const doc = { ...OMNICARE_PFS, is_active: false };
    assert.equal(isDocActiveAndQualityOk(doc), false);
    assert.equal(isDocValidForChecklistKey(doc, "PFS_CURRENT"), false);
  });

  test("#4 failed / rejected / superseded quality does NOT satisfy", () => {
    for (const q of ["FAILED", "REJECTED", "QUALITY_FAILED", "SUPERSEDED", "ERROR"]) {
      const doc = { ...OMNICARE_PFS, quality_status: q };
      assert.equal(
        isDocValidForChecklistKey(doc, "PFS_CURRENT"),
        false,
        `quality_status=${q} must not satisfy`,
      );
    }
  });

  test("#4 wrong-type doc does NOT satisfy PFS_CURRENT", () => {
    const btr = {
      id: "x",
      canonical_type: "BUSINESS_TAX_RETURN",
      document_type: "business_tax_return",
      checklist_key: null,
      quality_status: "PASSED",
      is_active: true,
    };
    assert.equal(docMatchesChecklistKey(btr, "PFS_CURRENT"), false);
    assert.equal(isDocValidForChecklistKey(btr, "PFS_CURRENT"), false);
  });

  test("PASSED is not required — unknown/empty quality is tolerated (older envs)", () => {
    const doc = { ...OMNICARE_PFS, quality_status: null };
    assert.equal(isDocActiveAndQualityOk(doc), true);
    assert.equal(isDocValidForChecklistKey(doc, "PFS_CURRENT"), true);
  });
});

describe("direct checklist_key match is honored", () => {
  test("doc already stamped with the item key satisfies even without type info", () => {
    const doc = {
      id: "y",
      checklist_key: "PFS_CURRENT",
      canonical_type: null,
      document_type: null,
      quality_status: "PASSED",
      is_active: true,
    };
    assert.equal(isDocValidForChecklistKey(doc, "PFS_CURRENT"), true);
  });
});
