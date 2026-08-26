/**
 * SPEC-PRODUCT-TYPE-CANON-1 regression tests.
 *
 * The 2026-08-26 audit found five fields carrying four vocabularies for
 * "this is an SBA 7(a) deal", and confirmed against production that
 * deal_intake_scenario had ZERO rows — so the SBA_7A slot policy had never
 * once activated, and every SBA borrower was collected against the
 * conventional slot set and shown a CRE document checklist.
 *
 * These tests pin the reconciliation so the spellings cannot drift apart
 * again.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// seedPortalChecklist and the slot policies are `server-only` modules; the
// shim lets them load under plain `node --test`, same pattern as
// src/lib/portal/__tests__/seedPortalChecklist.test.ts.
mockServerOnly();
const require = createRequire(import.meta.url);

const {
  normalizeProductType,
  resolveProductType,
  isSBA,
  requiresSBAChecklist,
} = require("../dealProductType") as typeof import("../dealProductType");
const { normalizeLoanTypeForChecklist } =
  require("../../portal/seedPortalChecklist") as typeof import("../../portal/seedPortalChecklist");
const { resolveSlotPolicy } =
  require("../../intake/slots/policies") as typeof import("../../intake/slots/policies");

describe("normalizeProductType", () => {
  it("maps every SBA 7(a) spelling seen in production to SBA_7A", () => {
    // '7a' is what the borrower concierge writes to deals.loan_type;
    // 'SBA' is what claim_brokerage_session writes to deals.deal_type.
    for (const raw of ["SBA_7A", "sba_7a", "7a", "7A", "SBA", "sba", "SBA7A", "SBA 7(a)"]) {
      assert.equal(normalizeProductType(raw), "SBA_7A", `spelling: ${raw}`);
    }
  });

  it("keeps the other programs distinct", () => {
    assert.equal(normalizeProductType("sba_504"), "SBA_504");
    assert.equal(normalizeProductType("504"), "SBA_504");
    assert.equal(normalizeProductType("SBA_EXPRESS"), "SBA_EXPRESS");
    assert.equal(normalizeProductType("LOC"), "LINE_OF_CREDIT");
    assert.equal(normalizeProductType("CRE"), "CRE");
  });

  it("returns null for unknown or empty input rather than guessing", () => {
    for (const raw of ["", null, undefined, "banana"]) {
      assert.equal(normalizeProductType(raw), null);
    }
  });
});

describe("resolveProductType", () => {
  it("prefers the canonical product_type when present", () => {
    assert.equal(
      resolveProductType({ product_type: "SBA_504", loan_type: "7a", deal_type: "SBA" }),
      "SBA_504",
    );
  });

  it("recovers SBA_7A from a live buddysba.com deal shape", () => {
    // Exactly what claim_brokerage_session + borrower intake produced before
    // this spec: product_type NULL, loan_type '7a', deal_type 'SBA'.
    assert.equal(
      resolveProductType({ product_type: null, loan_type: "7a", deal_type: "SBA" }),
      "SBA_7A",
    );
  });

  it("falls back through intake loan_type before the legacy deal_type flag", () => {
    assert.equal(
      resolveProductType({
        product_type: null,
        loan_type: null,
        intake_loan_type: "SBA_504",
        deal_type: "SBA",
      }),
      "SBA_504",
    );
  });

  it("returns null when nothing identifies the product", () => {
    assert.equal(resolveProductType({ product_type: null, deal_type: null }), null);
  });

  it("reads product_type STRICTLY — an ambiguous value there is not guessed at", () => {
    // dealProductType.test.ts pins that getProductType('sba') is null:
    // product_type is the canonical column and 'sba' does not say whether the
    // deal is 7(a), 504 or Express. resolveProductType must preserve that,
    // and fall through to the legacy fields rather than guessing.
    assert.equal(resolveProductType({ product_type: "sba" }), null);
    assert.equal(
      resolveProductType({ product_type: "sba", loan_type: "sba_504" }),
      "SBA_504",
      "an ambiguous product_type must not shadow a specific legacy field",
    );
  });
});

describe("SBA predicates on the production deal shape", () => {
  it("isSBA still requires an explicit product_type", () => {
    // Deliberately unchanged: isSBA is the strict reader. The fix is that
    // deals now GET a product_type, not that isSBA got looser.
    assert.equal(isSBA({ product_type: null, deal_type: "SBA" }), false);
    assert.equal(isSBA({ product_type: "SBA_7A" }), true);
  });

  it("requiresSBAChecklist keeps the legacy deal_type fallback", () => {
    assert.equal(requiresSBAChecklist({ product_type: null, deal_type: "SBA" }), true);
    assert.equal(requiresSBAChecklist({ product_type: "CRE", deal_type: "SBA" }), false);
  });
});

describe("checklist normalization", () => {
  it("no longer sends a 7(a) borrower down the CRE checklist", () => {
    // The exact regression: '7a' was not in KNOWN_LOAN_TYPES and not among
    // the old aliases, so it fell through to "CRE".
    assert.equal(normalizeLoanTypeForChecklist("7a"), "SBA_7A");
    assert.equal(normalizeLoanTypeForChecklist("SBA"), "SBA_7A");
    assert.equal(normalizeLoanTypeForChecklist("sba_7a"), "SBA_7A");
  });

  it("still defaults to CRE for genuinely unknown input", () => {
    assert.equal(normalizeLoanTypeForChecklist("banana"), "CRE");
    assert.equal(normalizeLoanTypeForChecklist(null), "CRE");
  });
});

describe("slot policy selection", () => {
  it("selects the SBA 7(a) policy for the canonical product", () => {
    const policy = resolveSlotPolicy("SBA_7A");
    const slots = policy.generateSlots(
      {
        product_type: "SBA_7A",
        borrower_business_stage: "EXISTING",
        has_business_tax_returns: true,
        has_financial_statements: true,
        has_projections: false,
        entity_age_months: null,
      },
      new Date("2026-08-26T00:00:00Z"),
    );
    const keys = slots.map((s) => s.slot_key);
    for (const required of ["SBA_1919", "SBA_413", "SBA_DEBT_SCHEDULE"]) {
      assert.ok(keys.includes(required), `expected slot ${required}, got ${keys.join(", ")}`);
    }
  });

  it("does not emit SBA form slots for a conventional deal", () => {
    const policy = resolveSlotPolicy("CONVENTIONAL");
    const slots = policy.generateSlots(
      {
        product_type: "CONVENTIONAL",
        borrower_business_stage: "EXISTING",
        has_business_tax_returns: true,
        has_financial_statements: true,
        has_projections: false,
        entity_age_months: null,
      },
      new Date("2026-08-26T00:00:00Z"),
    );
    assert.ok(!slots.some((s) => s.slot_key === "SBA_1919"));
  });
});
