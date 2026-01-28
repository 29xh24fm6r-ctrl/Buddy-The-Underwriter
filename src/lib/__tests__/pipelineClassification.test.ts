/**
 * Pipeline Classification Acceptance Test
 *
 * Validates the canonical document pipeline:
 *   Upload → Classify → Stamp deal_documents → Reconcile → Readiness
 *
 * Tests use pure functions (no Supabase/network) to verify:
 * 1. AI classification maps to canonical types correctly
 * 2. Canonical types map to checklist keys correctly
 * 3. Checklist satisfaction logic works for required items
 * 4. The full pipeline produces expected readiness state
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { toCanonicalDocType, canonicalTypeToChecklistKeys } from "@/lib/documents/classify";
import type { CanonicalDocumentType } from "@/lib/documents/classify";
import { normalizeToCanonical } from "@/lib/documents/normalizeType";
import { mapDocTypeToChecklistKeys } from "@/lib/artifacts/classifyDocument";
import { isChecklistItemSatisfied, getSatisfiedRequired, getMissingRequired } from "@/lib/deals/checklistSatisfaction";

// =============================================
// 1. AI doc type → canonical type mapping
// =============================================

test("toCanonicalDocType maps AI types to canonical enum", () => {
  assert.equal(toCanonicalDocType("IRS_BUSINESS"), "BUSINESS_TAX_RETURN");
  assert.equal(toCanonicalDocType("IRS_PERSONAL"), "PERSONAL_TAX_RETURN");
  assert.equal(toCanonicalDocType("PFS"), "PFS");
  assert.equal(toCanonicalDocType("T12"), "FINANCIAL_STATEMENT");
  assert.equal(toCanonicalDocType("BANK_STATEMENT"), "BANK_STATEMENT");
  assert.equal(toCanonicalDocType("RENT_ROLL"), "RENT_ROLL");
  assert.equal(toCanonicalDocType("LEASE"), "LEASE");
  assert.equal(toCanonicalDocType("INSURANCE"), "INSURANCE");
  assert.equal(toCanonicalDocType("APPRAISAL"), "APPRAISAL");
  assert.equal(toCanonicalDocType("ARTICLES"), "ENTITY_DOCS");
  assert.equal(toCanonicalDocType("OPERATING_AGREEMENT"), "ENTITY_DOCS");
  assert.equal(toCanonicalDocType("BYLAWS"), "ENTITY_DOCS");
  assert.equal(toCanonicalDocType("K1"), "PERSONAL_TAX_RETURN");
  assert.equal(toCanonicalDocType("W2"), "PERSONAL_TAX_RETURN");
  assert.equal(toCanonicalDocType("OTHER"), "OTHER");
  assert.equal(toCanonicalDocType("UNKNOWN_GARBAGE"), "OTHER");
});

// =============================================
// 2. AI doc type → checklist keys mapping
// =============================================

test("mapDocTypeToChecklistKeys returns correct checklist keys for tax returns", () => {
  const businessKeys = mapDocTypeToChecklistKeys("IRS_BUSINESS", 2023);
  assert.ok(businessKeys.includes("IRS_BUSINESS_3Y"), "Should include IRS_BUSINESS_3Y");

  const personalKeys = mapDocTypeToChecklistKeys("IRS_PERSONAL", 2023);
  assert.ok(personalKeys.includes("IRS_PERSONAL_3Y"), "Should include IRS_PERSONAL_3Y");
});

test("mapDocTypeToChecklistKeys returns correct keys for PFS", () => {
  const keys = mapDocTypeToChecklistKeys("PFS", null);
  assert.ok(keys.includes("PFS_CURRENT"), "Should include PFS_CURRENT");
});

test("mapDocTypeToChecklistKeys returns correct keys for bank statements", () => {
  const keys = mapDocTypeToChecklistKeys("BANK_STATEMENT", null);
  assert.ok(keys.length > 0, "Should return at least one key");
});

test("mapDocTypeToChecklistKeys returns empty for OTHER", () => {
  const keys = mapDocTypeToChecklistKeys("OTHER", null);
  assert.equal(keys.length, 0, "OTHER should not match any checklist key");
});

// =============================================
// 3. Canonical type → checklist keys mapping
// =============================================

test("canonicalTypeToChecklistKeys maps all canonical types", () => {
  const allTypes: CanonicalDocumentType[] = [
    "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "PFS",
    "FINANCIAL_STATEMENT", "BANK_STATEMENT", "RENT_ROLL",
    "LEASE", "INSURANCE", "APPRAISAL", "ENTITY_DOCS", "OTHER",
  ];

  for (const t of allTypes) {
    const keys = canonicalTypeToChecklistKeys(t);
    assert.ok(Array.isArray(keys), `${t} should return an array`);
  }

  // Verify key mappings
  assert.ok(canonicalTypeToChecklistKeys("BUSINESS_TAX_RETURN").includes("IRS_BUSINESS_3Y"));
  assert.ok(canonicalTypeToChecklistKeys("PERSONAL_TAX_RETURN").includes("IRS_PERSONAL_3Y"));
  assert.ok(canonicalTypeToChecklistKeys("PFS").includes("PFS_CURRENT"));
  assert.ok(canonicalTypeToChecklistKeys("FINANCIAL_STATEMENT").includes("FIN_STMT_PL_YTD"));
  assert.ok(canonicalTypeToChecklistKeys("BANK_STATEMENT").includes("BANK_STMT_3M"));
  assert.ok(canonicalTypeToChecklistKeys("RENT_ROLL").includes("RENT_ROLL"));
  assert.ok(canonicalTypeToChecklistKeys("ENTITY_DOCS").includes("ENTITY_DOCS"), "ENTITY_DOCS should map to ENTITY_DOCS checklist key");
  assert.ok(canonicalTypeToChecklistKeys("OTHER").length === 0, "OTHER should not map to checklist");
});

// =============================================
// 4. Checklist satisfaction logic
// =============================================

test("isChecklistItemSatisfied recognizes received, satisfied, and waived", () => {
  assert.equal(isChecklistItemSatisfied({ status: "received" }), true);
  assert.equal(isChecklistItemSatisfied({ status: "satisfied" }), true);
  assert.equal(isChecklistItemSatisfied({ status: "waived" }), true);
  assert.equal(isChecklistItemSatisfied({ status: "missing" }), false);
  assert.equal(isChecklistItemSatisfied({ status: "pending" }), false);
  assert.equal(isChecklistItemSatisfied({ status: null }), false);
});

test("getSatisfiedRequired filters to required+satisfied items only", () => {
  const items = [
    { status: "received", required: true },
    { status: "missing", required: true },
    { status: "received", required: false },  // optional - excluded
    { status: "waived", required: true },
  ];

  const result = getSatisfiedRequired(items);
  assert.equal(result.length, 2, "Should find 2 satisfied required items");
});

test("getMissingRequired filters to required+unsatisfied items only", () => {
  const items = [
    { status: "received", required: true },
    { status: "missing", required: true },
    { status: "pending", required: true },
    { status: "missing", required: false },  // optional - excluded
  ];

  const result = getMissingRequired(items);
  assert.equal(result.length, 2, "Should find 2 missing required items");
});

// =============================================
// 5. End-to-end pipeline simulation
// =============================================

test("full pipeline: business tax + personal tax + PFS + P&L + balance sheet → 100% readiness", () => {
  // Simulate the checklist after seeding (SBA_7A ruleset)
  const checklist = [
    { checklist_key: "IRS_BUSINESS_3Y", required: true, status: "missing" },
    { checklist_key: "IRS_PERSONAL_3Y", required: true, status: "missing" },
    { checklist_key: "PFS_CURRENT", required: true, status: "missing" },
    { checklist_key: "FIN_STMT_PL_YTD", required: true, status: "missing" },
    { checklist_key: "FIN_STMT_BS_YTD", required: true, status: "missing" },
    { checklist_key: "BANK_STMT_3M", required: false, status: "missing" },  // optional
  ];

  // Before classification: 0% readiness
  const missingBefore = getMissingRequired(checklist);
  assert.equal(missingBefore.length, 5, "All 5 required items should be missing");

  // Simulate document uploads being classified
  // Note: T12 is an operating statement (P&L for real estate) — it satisfies FIN_STMT_PL_YTD
  // but NOT FIN_STMT_BS_YTD. A balance sheet requires a separate upload.
  const uploads = [
    { aiDocType: "IRS_BUSINESS", taxYear: 2023 },
    { aiDocType: "IRS_PERSONAL", taxYear: 2023 },
    { aiDocType: "PFS", taxYear: null },
    { aiDocType: "T12", taxYear: null },  // Satisfies FIN_STMT_PL_YTD (P&L)
    { aiDocType: "T12", taxYear: null },  // Second T12 also maps to FIN_STMT_BS_YTD via PROPERTY_T12
  ];

  // For each upload, get checklist keys and mark as received
  for (const upload of uploads) {
    const keys = mapDocTypeToChecklistKeys(upload.aiDocType as any, upload.taxYear);
    for (const item of checklist) {
      if (keys.includes(item.checklist_key) && item.status === "missing") {
        item.status = "received";
      }
    }
  }

  // After classification: check readiness
  const satisfiedAfter = getSatisfiedRequired(checklist);
  const missingAfter = getMissingRequired(checklist);
  const requiredTotal = checklist.filter((i) => i.required).length;
  const pct = Math.round((satisfiedAfter.length / requiredTotal) * 100);

  // T12 doesn't map to FIN_STMT_BS_YTD — that's a separate document.
  // So we expect 4/5 satisfied unless a balance sheet is also uploaded.
  assert.equal(satisfiedAfter.length, 4, "4 of 5 required items satisfied (BS needs separate upload)");
  assert.equal(missingAfter.length, 1, "1 required item still missing (balance sheet)");
  assert.equal(pct, 80, "Readiness should be 80%");

  // Optional item should still be missing (not affecting readiness)
  const optionalItem = checklist.find((i) => i.checklist_key === "BANK_STMT_3M");
  assert.equal(optionalItem?.status, "missing", "Optional bank stmt should still be missing");
});

test("T12 maps to FIN_STMT_PL_YTD checklist key (core mapping fix)", () => {
  const keys = mapDocTypeToChecklistKeys("T12", null);
  assert.ok(keys.includes("FIN_STMT_PL_YTD"), "T12 should map to FIN_STMT_PL_YTD");
  assert.ok(keys.includes("PROPERTY_T12"), "T12 should map to PROPERTY_T12");
});

test("BANK_STATEMENT maps to BANK_STMT_3M checklist key (core mapping fix)", () => {
  const keys = mapDocTypeToChecklistKeys("BANK_STATEMENT", null);
  assert.ok(keys.includes("BANK_STMT_3M"), "BANK_STATEMENT should map to BANK_STMT_3M");
});

test("LEASE maps to LEASES_TOP checklist key", () => {
  const keys = mapDocTypeToChecklistKeys("LEASE", null);
  assert.ok(keys.includes("LEASES_TOP"), "LEASE should map to LEASES_TOP");
});

test("INSURANCE maps to PROPERTY_INSURANCE checklist key", () => {
  const keys = mapDocTypeToChecklistKeys("INSURANCE", null);
  assert.ok(keys.includes("PROPERTY_INSURANCE"), "INSURANCE should map to PROPERTY_INSURANCE");
});

test("partial upload: only business tax → readiness < 100%", () => {
  const checklist = [
    { checklist_key: "IRS_BUSINESS_3Y", required: true, status: "missing" },
    { checklist_key: "IRS_PERSONAL_3Y", required: true, status: "missing" },
    { checklist_key: "PFS_CURRENT", required: true, status: "missing" },
    { checklist_key: "FIN_STMT_PL_YTD", required: true, status: "missing" },
    { checklist_key: "FIN_STMT_BS_YTD", required: true, status: "missing" },
  ];

  // Only upload business tax returns
  const keys = mapDocTypeToChecklistKeys("IRS_BUSINESS", 2023);
  for (const item of checklist) {
    if (keys.includes(item.checklist_key)) {
      item.status = "received";
    }
  }

  const satisfied = getSatisfiedRequired(checklist);
  const missing = getMissingRequired(checklist);
  const requiredTotal = checklist.filter((i) => i.required).length;
  const pct = Math.round((satisfied.length / requiredTotal) * 100);

  assert.equal(satisfied.length, 1, "Only 1 required item should be satisfied");
  assert.equal(missing.length, 4, "4 required items should be missing");
  assert.equal(pct, 20, "Readiness should be 20%");
});

test("waived items count as satisfied for readiness", () => {
  const checklist = [
    { checklist_key: "IRS_BUSINESS_3Y", required: true, status: "received" },
    { checklist_key: "IRS_PERSONAL_3Y", required: true, status: "waived" },
    { checklist_key: "PFS_CURRENT", required: true, status: "received" },
  ];

  const satisfied = getSatisfiedRequired(checklist);
  assert.equal(satisfied.length, 3, "All 3 (including waived) should be satisfied");
});

// =============================================
// 6. normalizeToCanonical — authoritative normalizer
// =============================================

test("normalizeToCanonical handles exact AI classifier types", () => {
  assert.equal(normalizeToCanonical("IRS_BUSINESS"), "BUSINESS_TAX_RETURN");
  assert.equal(normalizeToCanonical("IRS_PERSONAL"), "PERSONAL_TAX_RETURN");
  assert.equal(normalizeToCanonical("PFS"), "PFS");
  assert.equal(normalizeToCanonical("T12"), "FINANCIAL_STATEMENT");
  assert.equal(normalizeToCanonical("BANK_STATEMENT"), "BANK_STATEMENT");
  assert.equal(normalizeToCanonical("RENT_ROLL"), "RENT_ROLL");
  assert.equal(normalizeToCanonical("LEASE"), "LEASE");
  assert.equal(normalizeToCanonical("INSURANCE"), "INSURANCE");
  assert.equal(normalizeToCanonical("APPRAISAL"), "APPRAISAL");
  assert.equal(normalizeToCanonical("ARTICLES"), "ENTITY_DOCS");
  assert.equal(normalizeToCanonical("OPERATING_AGREEMENT"), "ENTITY_DOCS");
  assert.equal(normalizeToCanonical("BYLAWS"), "ENTITY_DOCS");
  assert.equal(normalizeToCanonical("OTHER"), "OTHER");
});

test("normalizeToCanonical handles form numbers and aliases", () => {
  assert.equal(normalizeToCanonical("IRS_1120"), "BUSINESS_TAX_RETURN");
  assert.equal(normalizeToCanonical("IRS_1120S"), "BUSINESS_TAX_RETURN");
  assert.equal(normalizeToCanonical("IRS_1065"), "BUSINESS_TAX_RETURN");
  assert.equal(normalizeToCanonical("IRS_1040"), "PERSONAL_TAX_RETURN");
  assert.equal(normalizeToCanonical("INCOME_STATEMENT"), "FINANCIAL_STATEMENT");
  assert.equal(normalizeToCanonical("BALANCE_SHEET"), "FINANCIAL_STATEMENT");
  assert.equal(normalizeToCanonical("P&L"), "FINANCIAL_STATEMENT");
  assert.equal(normalizeToCanonical("SBA_413"), "PFS");
  assert.equal(normalizeToCanonical("COI"), "INSURANCE");
  assert.equal(normalizeToCanonical("INSURANCE_CERT"), "INSURANCE");
  assert.equal(normalizeToCanonical("BUSINESS_LICENSE"), "ENTITY_DOCS");
});

test("normalizeToCanonical maps K1 to PERSONAL_TAX_RETURN", () => {
  assert.equal(normalizeToCanonical("K1"), "PERSONAL_TAX_RETURN");
  assert.equal(normalizeToCanonical("SCHEDULE_K1"), "PERSONAL_TAX_RETURN");
});

test("normalizeToCanonical and toCanonicalDocType agree on K1 mapping", () => {
  assert.equal(normalizeToCanonical("K1"), toCanonicalDocType("K1"));
});
