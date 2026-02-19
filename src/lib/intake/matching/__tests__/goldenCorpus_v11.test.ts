/**
 * Golden Corpus v1.1 — CI-Blocking Match Invariants for Period + Entity
 *
 * Extends the golden corpus with 10 new test cases (#16–#25) focusing on:
 *   - Period extraction gating (multi-year, year confidence)
 *   - Entity resolution routing (entity match, ambiguity gate)
 *   - Statement type routing (YTD, TTM)
 *   - Specific form-to-slot mappings (SBA-413, 1040-SR, INSURANCE)
 *
 * Every entry runs through matchDocumentToSlot().
 * Wrong-attach count must equal 0.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { matchDocumentToSlot } from "../matchEngine";
import type { DocumentIdentity, SlotSnapshot, PeriodInfo, EntityInfo } from "../types";

// ---------------------------------------------------------------------------
// Identity builder
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<DocumentIdentity>): DocumentIdentity {
  return {
    documentId: "golden-v11-doc",
    effectiveDocType: "OTHER",
    rawDocType: "OTHER",
    taxYear: null,
    entityType: null,
    formNumbers: null,
    authority: "deterministic",
    confidence: 0.97,
    classificationEvidence: [
      { type: "form_match", anchorId: "golden", matchedText: "test", confidence: 0.97 },
    ],
    period: null,
    entity: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Slot builder
// ---------------------------------------------------------------------------

function makeSlot(overrides?: Partial<SlotSnapshot>): SlotSnapshot {
  return {
    slotId: "slot-1",
    slotKey: "SLOT_1",
    slotGroup: "GROUP",
    requiredDocType: "OTHER",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    requiredEntityId: null,
    requiredEntityRole: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Golden corpus v1.1: Period + Entity test cases (#16–#25)
// ---------------------------------------------------------------------------

// #16: Multi-year P&L blocks year slot (not_multi_year constraint)
test("Golden #16: Multi-year BTR blocks year-bound slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    period: {
      periodStart: "2023-01-01",
      periodEnd: "2024-12-31",
      statementType: "annual",
      multiYear: true,
      taxYearConfidence: 0.95,
    },
  });
  const slots = [
    makeSlot({
      slotId: "btr-2024",
      slotKey: "BTR_2024",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match",
    "Multi-year document must NOT auto-attach to a single year slot");
});

// #17: BTR with entity match resolves to entity slot
test("Golden #17: BTR with entity match resolves to entity slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    entity: {
      entityId: "ent-opco",
      entityRole: "operating",
      confidence: 0.95,
      ambiguous: false,
    },
  });
  const slots = [
    makeSlot({
      slotId: "btr-2024-opco",
      slotKey: "BTR_2024_OPCO",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
      requiredEntityId: "ent-opco",
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "btr-2024-opco");
});

// #18: PFS with entity match
test("Golden #18: PFS with entity match resolves to entity slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "PFS",
    rawDocType: "PFS",
    taxYear: null,
    entityType: "personal",
    authority: "probabilistic",
    confidence: 0.92,
    entity: {
      entityId: "ent-guar",
      entityRole: "guarantor",
      confidence: 0.90,
      ambiguous: false,
    },
  });
  const slots = [
    makeSlot({
      slotId: "pfs-guar",
      slotKey: "PFS_GUARANTOR",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 1,
      requiredEntityId: "ent-guar",
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "pfs-guar");
});

// #19: BTR with ambiguous entity -> review
test("Golden #19: BTR with ambiguous entity routes to review", () => {
  const identity = makeIdentity({
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    entity: {
      entityId: null,
      entityRole: null,
      confidence: 0.70,
      ambiguous: true,
    },
  });
  const slots = [
    makeSlot({
      slotId: "btr-2024-opco",
      slotKey: "BTR_2024_OPCO",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
      requiredEntityId: "ent-opco",
    }),
    makeSlot({
      slotId: "btr-2024-holdco",
      slotKey: "BTR_2024_HOLDCO",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 2,
      requiredEntityId: "ent-holdco",
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "routed_to_review",
    "Ambiguous entity must route to review when entity-aware slots exist");
});

// #20: IS YTD matches IS_YTD slot
test("Golden #20: IS YTD matches IS slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "INCOME_STATEMENT",
    rawDocType: "INCOME_STATEMENT",
    taxYear: null,
    entityType: null,
    confidence: 0.92,
    period: {
      periodStart: "2025-01-01",
      periodEnd: "2025-09-30",
      statementType: "ytd",
      multiYear: false,
      taxYearConfidence: 0.75,
    },
  });
  const slots = [
    makeSlot({
      slotId: "is-1",
      slotKey: "IS_YTD",
      slotGroup: "financial",
      requiredDocType: "INCOME_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "is-1");
});

// #21: TTM -> IS slot (NOT T12 type)
test("Golden #21: TTM income statement matches IS slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "INCOME_STATEMENT",
    rawDocType: "INCOME_STATEMENT",
    taxYear: null,
    entityType: null,
    confidence: 0.92,
    period: {
      periodStart: "2024-10-01",
      periodEnd: "2025-09-30",
      statementType: "ttm",
      multiYear: false,
      taxYearConfidence: 0.0,
    },
  });
  const slots = [
    makeSlot({
      slotId: "is-1",
      slotKey: "IS_YTD",
      slotGroup: "financial",
      requiredDocType: "INCOME_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "is-1");
});

// #22: Low year confidence blocks year slot
test("Golden #22: Low year confidence blocks year-bound slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "BUSINESS_TAX_RETURN",
    rawDocType: "IRS_BUSINESS",
    taxYear: 2024,
    entityType: "business",
    period: {
      periodStart: null,
      periodEnd: null,
      statementType: "annual",
      multiYear: false,
      taxYearConfidence: 0.50,
    },
  });
  const slots = [
    makeSlot({
      slotId: "btr-2024",
      slotKey: "BTR_2024",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match",
    "Year confidence 0.50 is below 0.70 threshold — must not auto-attach");
});

// #23: SBA-413 -> PFS slot
test("Golden #23: SBA-413 (PFS type) matches PFS slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "PFS",
    rawDocType: "SBA_413",
    taxYear: null,
    entityType: "personal",
    authority: "deterministic",
    confidence: 0.97,
    formNumbers: ["SBA-413"],
  });
  const slots = [
    makeSlot({
      slotId: "pfs-1",
      slotKey: "PFS_CURRENT",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "pfs-1");
});

// #24: INSURANCE with no slot -> no_match
test("Golden #24: INSURANCE with no matching slot -> no_match", () => {
  const identity = makeIdentity({
    effectiveDocType: "INSURANCE",
    rawDocType: "INSURANCE",
    taxYear: null,
    entityType: null,
  });
  // Conventional slots — no INSURANCE slot exists
  const slots = [
    makeSlot({
      slotId: "btr-2024",
      slotKey: "BTR_2024",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
    makeSlot({
      slotId: "pfs-1",
      slotKey: "PFS_CURRENT",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 2,
    }),
    makeSlot({
      slotId: "is-1",
      slotKey: "IS_YTD",
      slotGroup: "financial",
      requiredDocType: "INCOME_STATEMENT",
      requiredTaxYear: null,
      sortOrder: 3,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "no_match");
});

// #25: 1040-SR -> PTR slot
test("Golden #25: 1040-SR (PTR type) matches PTR_2024 slot", () => {
  const identity = makeIdentity({
    effectiveDocType: "PERSONAL_TAX_RETURN",
    rawDocType: "1040_SR",
    taxYear: 2024,
    entityType: "personal",
    authority: "deterministic",
    confidence: 0.97,
    formNumbers: ["1040-SR"],
  });
  const slots = [
    makeSlot({
      slotId: "ptr-2024",
      slotKey: "PTR_2024",
      slotGroup: "tax",
      requiredDocType: "PERSONAL_TAX_RETURN",
      requiredTaxYear: 2024,
      sortOrder: 1,
    }),
  ];
  const result = matchDocumentToSlot(identity, slots);
  assert.equal(result.decision, "auto_attached");
  assert.equal(result.slotId, "ptr-2024");
});

// --- CI Invariant: All golden v1.1 tests enforce zero wrong-attach ---
// Each test uses assert.equal for expected decision + slot, with descriptive
// failure messages on gating constraints. Any wrong-attach fails directly.
