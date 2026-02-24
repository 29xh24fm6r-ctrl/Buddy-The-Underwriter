import test from "node:test";
import assert from "node:assert/strict";

/**
 * Smart Router + Canonical Doc-Type Routing Tests
 *
 * Tests the routing_class system:
 *   GEMINI_STRUCTURED → Gemini OCR + advisory structured assist (tax returns, IS, BS, PFS)
 *   GEMINI_PACKET     → Gemini OCR with multi-page awareness (generic financials)
 *   GEMINI_STANDARD   → Standard Gemini OCR (everything else)
 *
 * Also tests:
 * - Raw type → canonical_type normalization
 * - Legacy alias handling
 * - Case normalization
 * - Null/undefined safety
 */

// Import the helper under test (avoids "server-only" in the router)
import {
  resolveDocTypeRouting,
  routingClassFor,
  isStructuredExtractionRoute,
} from "@/lib/documents/docTypeRouting";

// ─── GEMINI_STRUCTURED: Tax Returns ─────────────────────────────────────────

test("BUSINESS_TAX_RETURN → GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("BUSINESS_TAX_RETURN");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("IRS_BUSINESS → BUSINESS_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("IRS_BUSINESS");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("IRS_1120 → BUSINESS_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("IRS_1120");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("IRS_1120S → BUSINESS_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("IRS_1120S");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("IRS_1065 → BUSINESS_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("IRS_1065");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("PERSONAL_TAX_RETURN → GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("PERSONAL_TAX_RETURN");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("IRS_PERSONAL → PERSONAL_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("IRS_PERSONAL");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("IRS_1040 → PERSONAL_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("IRS_1040");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("K1 → PERSONAL_TAX_RETURN / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("K1");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

// ─── GEMINI_STRUCTURED: Income Statement ────────────────────────────────────

test("INCOME_STATEMENT → GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("INCOME_STATEMENT");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("PROFIT_AND_LOSS → INCOME_STATEMENT / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("PROFIT_AND_LOSS");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("P&L → INCOME_STATEMENT / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("P&L");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("T12 → INCOME_STATEMENT / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("T12");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

// ─── GEMINI_STRUCTURED: Balance Sheet ───────────────────────────────────────

test("BALANCE_SHEET → GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("BALANCE_SHEET");
  assert.equal(r.canonical_type, "BALANCE_SHEET");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

// ─── GEMINI_STRUCTURED: PFS ─────────────────────────────────────────────────

test("PFS → GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("PFS");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("PERSONAL_FINANCIAL_STATEMENT → PFS / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("PERSONAL_FINANCIAL_STATEMENT");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("SBA_413 → PFS / GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("SBA_413");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

// ─── GEMINI_PACKET: Generic Financial Statement ─────────────────────────────

test("FINANCIAL_STATEMENT → GEMINI_PACKET", () => {
  const r = resolveDocTypeRouting("FINANCIAL_STATEMENT");
  assert.equal(r.canonical_type, "FINANCIAL_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_PACKET");
});

test("INTERIM_FINANCIALS → FINANCIAL_STATEMENT / GEMINI_PACKET", () => {
  const r = resolveDocTypeRouting("INTERIM_FINANCIALS");
  assert.equal(r.canonical_type, "FINANCIAL_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_PACKET");
});

// ─── GEMINI_STANDARD: Rent Roll ─────────────────────────────────────────────

test("RENT_ROLL → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("RENT_ROLL");
  assert.equal(r.canonical_type, "RENT_ROLL");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

// ─── GEMINI_STANDARD: Other Standard Types ──────────────────────────────────

test("BANK_STATEMENT → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("BANK_STATEMENT");
  assert.equal(r.canonical_type, "BANK_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("LEASE → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("LEASE");
  assert.equal(r.canonical_type, "LEASE");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("INSURANCE → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("INSURANCE");
  assert.equal(r.canonical_type, "INSURANCE");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("APPRAISAL → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("APPRAISAL");
  assert.equal(r.canonical_type, "APPRAISAL");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("ENTITY_DOCS → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("ENTITY_DOCS");
  assert.equal(r.canonical_type, "ENTITY_DOCS");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("OTHER → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("OTHER");
  assert.equal(r.canonical_type, "OTHER");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

// ─── GEMINI_STANDARD: Entity doc sub-types ──────────────────────────────────

test("ARTICLES → ENTITY_DOCS / GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("ARTICLES");
  assert.equal(r.canonical_type, "ENTITY_DOCS");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("OPERATING_AGREEMENT → ENTITY_DOCS / GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("OPERATING_AGREEMENT");
  assert.equal(r.canonical_type, "ENTITY_DOCS");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

// ─── isStructuredExtractionRoute helper ─────────────────────────────────────

test("isStructuredExtractionRoute returns true for GEMINI_STRUCTURED", () => {
  assert.equal(isStructuredExtractionRoute("GEMINI_STRUCTURED"), true);
});

test("isStructuredExtractionRoute returns false for GEMINI_PACKET", () => {
  assert.equal(isStructuredExtractionRoute("GEMINI_PACKET"), false);
});

test("isStructuredExtractionRoute returns false for GEMINI_STANDARD", () => {
  assert.equal(isStructuredExtractionRoute("GEMINI_STANDARD"), false);
});

// ─── routingClassFor helper ─────────────────────────────────────────────────

test("routingClassFor returns GEMINI_STRUCTURED for BUSINESS_TAX_RETURN", () => {
  assert.equal(routingClassFor("BUSINESS_TAX_RETURN"), "GEMINI_STRUCTURED");
});

test("routingClassFor returns GEMINI_PACKET for FINANCIAL_STATEMENT", () => {
  assert.equal(routingClassFor("FINANCIAL_STATEMENT"), "GEMINI_PACKET");
});

test("routingClassFor returns GEMINI_STANDARD for unknown type", () => {
  assert.equal(routingClassFor("NEVER_SEEN_BEFORE"), "GEMINI_STANDARD");
});

// ─── Case Normalization ─────────────────────────────────────────────────────

test("normalizes lowercase to canonical type", () => {
  const r = resolveDocTypeRouting("business_tax_return");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("normalizes mixed case to canonical type", () => {
  const r = resolveDocTypeRouting("Income_Statement");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("normalizes with leading/trailing whitespace", () => {
  const r = resolveDocTypeRouting("  PFS  ");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

test("handles hyphenated types", () => {
  const r = resolveDocTypeRouting("balance-sheet");
  assert.equal(r.canonical_type, "BALANCE_SHEET");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
});

// ─── Null/Undefined Safety ──────────────────────────────────────────────────

test("handles null gracefully", () => {
  const r = resolveDocTypeRouting(null as any);
  assert.equal(r.canonical_type, "OTHER");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("handles undefined gracefully", () => {
  const r = resolveDocTypeRouting(undefined as any);
  assert.equal(r.canonical_type, "OTHER");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

test("handles empty string gracefully", () => {
  const r = resolveDocTypeRouting("");
  assert.equal(r.canonical_type, "OTHER");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

// ─── Cost Leak Prevention ───────────────────────────────────────────────────

test("RENT_ROLL does NOT route to GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("RENT_ROLL");
  assert.notEqual(r.routing_class, "GEMINI_STRUCTURED");
});

test("BANK_STATEMENT does NOT route to GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("BANK_STATEMENT");
  assert.notEqual(r.routing_class, "GEMINI_STRUCTURED");
});

test("FINANCIAL_STATEMENT (generic) does NOT route to GEMINI_STRUCTURED", () => {
  const r = resolveDocTypeRouting("FINANCIAL_STATEMENT");
  assert.notEqual(r.routing_class, "GEMINI_STRUCTURED");
});

// ─── Scope Guardrails ───────────────────────────────────────────────────────

test("exactly 5 canonical types route to GEMINI_STRUCTURED", () => {
  const structuredTypes = [
    "BUSINESS_TAX_RETURN",
    "PERSONAL_TAX_RETURN",
    "INCOME_STATEMENT",
    "BALANCE_SHEET",
    "PFS",
  ];

  for (const t of structuredTypes) {
    assert.equal(
      routingClassFor(t),
      "GEMINI_STRUCTURED",
      `Expected ${t} to be GEMINI_STRUCTURED`,
    );
  }
});

test("exactly 1 canonical type routes to GEMINI_PACKET", () => {
  const packetTypes = ["FINANCIAL_STATEMENT"];

  for (const t of packetTypes) {
    assert.equal(
      routingClassFor(t),
      "GEMINI_PACKET",
      `Expected ${t} to be GEMINI_PACKET`,
    );
  }
});

test("remaining canonical types route to GEMINI_STANDARD", () => {
  const standardTypes = [
    "RENT_ROLL",
    "BANK_STATEMENT",
    "LEASE",
    "INSURANCE",
    "APPRAISAL",
    "ENTITY_DOCS",
    "OTHER",
  ];

  for (const t of standardTypes) {
    assert.equal(
      routingClassFor(t),
      "GEMINI_STANDARD",
      `Expected ${t} to be GEMINI_STANDARD`,
    );
  }
});

// ─── Structured Extraction Route ────────────────────────────────────────────

test("GEMINI_STRUCTURED types get structured assist", () => {
  const r = resolveDocTypeRouting("BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "GEMINI_STRUCTURED");
  assert.equal(isStructuredExtractionRoute(r.routing_class), true);
});

test("GEMINI_STANDARD types do not get structured assist", () => {
  const r = resolveDocTypeRouting("BANK_STATEMENT");
  assert.equal(isStructuredExtractionRoute(r.routing_class), false);
});

test("GEMINI_PACKET types do not get structured assist", () => {
  const r = resolveDocTypeRouting("FINANCIAL_STATEMENT");
  assert.equal(isStructuredExtractionRoute(r.routing_class), false);
});
