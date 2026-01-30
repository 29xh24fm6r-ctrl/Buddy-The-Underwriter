/**
 * Unit tests for deriveDocumentDisplayName.
 *
 * Run: npx tsx src/lib/naming/__tests__/deriveDocumentDisplayName.test.ts
 */

import { deriveDocumentDisplayName } from "../deriveDocumentDisplayName";
import assert from "node:assert/strict";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e: any) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("deriveDocumentDisplayName");

// ─── Derived names (doc_type present) ────────────────────────────────────────

test("BTR with year → 'Business Tax Return — 2023'", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "doc123.pdf",
    documentType: "BUSINESS_TAX_RETURN",
    docYear: 2023,
    entityName: null,
    classificationConfidence: 0.95,
  });
  assert.equal(r.displayName, "Business Tax Return \u2014 2023");
  assert.equal(r.method, "derived");
  assert.equal(r.source, "classification");
  assert.equal(r.fallbackReason, null);
});

test("BTR with entity + year → 'Business Tax Return — ABC Corp (2023)'", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "doc123.pdf",
    documentType: "BUSINESS_TAX_RETURN",
    docYear: 2023,
    entityName: "ABC Corp",
    classificationConfidence: 0.92,
  });
  assert.equal(r.displayName, "Business Tax Return \u2014 ABC Corp (2023)");
  assert.equal(r.method, "derived");
});

test("PFS with entity, no year → 'Personal Financial Statement — John Doe'", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "pfs.pdf",
    documentType: "PFS",
    docYear: null,
    entityName: "John Doe",
    classificationConfidence: 0.88,
  });
  assert.equal(r.displayName, "Personal Financial Statement \u2014 John Doe");
  assert.equal(r.method, "derived");
});

test("PTR with year, no entity → 'Personal Tax Return — 2022'", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "1040.pdf",
    documentType: "PERSONAL_TAX_RETURN",
    docYear: 2022,
    entityName: null,
    classificationConfidence: 0.91,
  });
  assert.equal(r.displayName, "Personal Tax Return \u2014 2022");
  assert.equal(r.method, "derived");
});

test("FINANCIAL_STATEMENT no year, no entity → 'Financial Statement'", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "statement.pdf",
    documentType: "FINANCIAL_STATEMENT",
    docYear: null,
    entityName: null,
    classificationConfidence: 0.85,
  });
  assert.equal(r.displayName, "Financial Statement");
  assert.equal(r.method, "derived");
});

test("BANK_STATEMENT with year → 'Bank Statement — 2024'", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "bank.pdf",
    documentType: "BANK_STATEMENT",
    docYear: 2024,
    entityName: null,
    classificationConfidence: 0.90,
  });
  assert.equal(r.displayName, "Bank Statement \u2014 2024");
  assert.equal(r.method, "derived");
});

// ─── Provisional fallbacks ───────────────────────────────────────────────────

test("null doc type → provisional from filename", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "2023_Tax_Return-final.pdf",
    documentType: null,
    docYear: null,
    entityName: null,
    classificationConfidence: null,
  });
  assert.equal(r.displayName, "2023 Tax Return final");
  assert.equal(r.method, "provisional");
  assert.equal(r.source, "filename");
  assert.equal(r.fallbackReason, "missing_classification");
});

test("OTHER doc type → provisional from filename", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "misc-document.pdf",
    documentType: "OTHER",
    docYear: null,
    entityName: null,
    classificationConfidence: 0.3,
  });
  assert.equal(r.displayName, "misc document");
  assert.equal(r.method, "provisional");
  assert.equal(r.fallbackReason, "classified_as_other");
});

test("empty filename → uses raw filename", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "",
    documentType: null,
    docYear: null,
    entityName: null,
    classificationConfidence: null,
  });
  assert.equal(r.displayName, "");
  assert.equal(r.method, "provisional");
});

// ─── Entity truncation ──────────────────────────────────────────────────────

test("long entity name gets truncated", () => {
  const longName = "A".repeat(100);
  const r = deriveDocumentDisplayName({
    originalFilename: "doc.pdf",
    documentType: "BUSINESS_TAX_RETURN",
    docYear: 2023,
    entityName: longName,
    classificationConfidence: 0.95,
  });
  assert.ok(r.displayName.length < 200, "Display name should be reasonable length");
  assert.ok(r.displayName.includes("\u2026"), "Should contain ellipsis");
});

// ─── Confidence passthrough ─────────────────────────────────────────────────

test("confidence is passed through for derived names", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "doc.pdf",
    documentType: "RENT_ROLL",
    docYear: null,
    entityName: null,
    classificationConfidence: 0.78,
  });
  assert.equal(r.confidence, 0.78);
});

test("confidence is null for provisional names", () => {
  const r = deriveDocumentDisplayName({
    originalFilename: "doc.pdf",
    documentType: null,
    docYear: null,
    entityName: null,
    classificationConfidence: null,
  });
  assert.equal(r.confidence, null);
});

console.log("\nAll tests passed!");
