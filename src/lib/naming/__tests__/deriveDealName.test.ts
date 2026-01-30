/**
 * Unit tests for deriveDealName.
 *
 * Run: npx tsx src/lib/naming/__tests__/deriveDealName.test.ts
 */

import { deriveDealName, type AnchorDocCandidate } from "../deriveDealName";
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

console.log("deriveDealName");

// ─── Anchor selection priority ───────────────────────────────────────────────

test("BTR beats PTR when both present", () => {
  const candidates: AnchorDocCandidate[] = [
    { documentType: "PERSONAL_TAX_RETURN", docYear: 2023, entityName: "John Doe", confidence: 0.95 },
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "ABC Corp", confidence: 0.90 },
  ];
  const r = deriveDealName(candidates);
  assert.equal(r.dealName, "ABC Corp \u2014 BTR 2023");
  assert.equal(r.method, "derived");
  assert.equal(r.anchorDocType, "BUSINESS_TAX_RETURN");
});

test("PTR beats PFS when BTR absent", () => {
  const candidates: AnchorDocCandidate[] = [
    { documentType: "PFS", docYear: null, entityName: "John Doe", confidence: 0.95 },
    { documentType: "PERSONAL_TAX_RETURN", docYear: 2022, entityName: "John Doe", confidence: 0.90 },
  ];
  const r = deriveDealName(candidates);
  assert.equal(r.dealName, "John Doe \u2014 PTR 2022");
  assert.equal(r.anchorDocType, "PERSONAL_TAX_RETURN");
});

test("PFS used when no tax returns", () => {
  const candidates: AnchorDocCandidate[] = [
    { documentType: "PFS", docYear: null, entityName: "Jane Smith", confidence: 0.88 },
    { documentType: "BANK_STATEMENT", docYear: 2024, entityName: null, confidence: 0.95 },
  ];
  const r = deriveDealName(candidates);
  assert.equal(r.dealName, "Jane Smith");
  assert.equal(r.anchorDocType, "PFS");
});

test("FINANCIAL_STATEMENT as fallback anchor", () => {
  const candidates: AnchorDocCandidate[] = [
    { documentType: "FINANCIAL_STATEMENT", docYear: 2024, entityName: "Widget LLC", confidence: 0.85 },
    { documentType: "BANK_STATEMENT", docYear: 2024, entityName: null, confidence: 0.95 },
  ];
  const r = deriveDealName(candidates);
  assert.equal(r.dealName, "Widget LLC \u2014 Financials 2024");
  assert.equal(r.anchorDocType, "FINANCIAL_STATEMENT");
});

// ─── Name formats ────────────────────────────────────────────────────────────

test("entity + year → 'Entity — Label Year'", () => {
  const r = deriveDealName([
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "Acme Inc", confidence: 0.95 },
  ]);
  assert.equal(r.dealName, "Acme Inc \u2014 BTR 2023");
});

test("entity only → 'Entity'", () => {
  const r = deriveDealName([
    { documentType: "PFS", docYear: null, entityName: "Michael Newmark", confidence: 0.90 },
  ]);
  assert.equal(r.dealName, "Michael Newmark");
});

test("year only, no entity → 'Deal — Label Year'", () => {
  const r = deriveDealName([
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: null, confidence: 0.85 },
  ]);
  assert.equal(r.dealName, "Deal \u2014 BTR 2023");
});

test("no year, no entity → 'Deal — Label'", () => {
  const r = deriveDealName([
    { documentType: "BUSINESS_TAX_RETURN", docYear: null, entityName: null, confidence: 0.80 },
  ]);
  assert.equal(r.dealName, "Deal \u2014 BTR");
});

// ─── Same type: prefer latest year ──────────────────────────────────────────

test("same type picks latest year", () => {
  const candidates: AnchorDocCandidate[] = [
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2021, entityName: "Old Corp", confidence: 0.95 },
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "New Corp", confidence: 0.90 },
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2022, entityName: "Mid Corp", confidence: 0.92 },
  ];
  const r = deriveDealName(candidates);
  assert.equal(r.dealName, "New Corp \u2014 BTR 2023");
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

test("empty candidates → null", () => {
  const r = deriveDealName([]);
  assert.equal(r.dealName, null);
  assert.equal(r.method, null);
  assert.equal(r.fallbackReason, "no_classified_documents");
});

test("only non-anchor types → null", () => {
  const r = deriveDealName([
    { documentType: "BANK_STATEMENT", docYear: 2024, entityName: null, confidence: 0.95 },
    { documentType: "LEASE", docYear: null, entityName: "Tenant", confidence: 0.90 },
    { documentType: "OTHER", docYear: null, entityName: null, confidence: 0.50 },
  ]);
  assert.equal(r.dealName, null);
  assert.equal(r.fallbackReason, "no_anchor_type_documents");
});

test("same type, same year: picks higher confidence", () => {
  const candidates: AnchorDocCandidate[] = [
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "Low Conf", confidence: 0.70 },
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "High Conf", confidence: 0.95 },
  ];
  const r = deriveDealName(candidates);
  assert.equal(r.dealName, "High Conf \u2014 BTR 2023");
});

console.log("\nAll tests passed!");
