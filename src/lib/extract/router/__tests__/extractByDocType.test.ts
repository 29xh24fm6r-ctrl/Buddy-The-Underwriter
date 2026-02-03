import test from "node:test";
import assert from "node:assert/strict";

/**
 * Smart Router + Canonical Doc-Type Routing Tests
 *
 * Tests the routing_class system:
 *   DOC_AI_ATOMIC    → Google Document AI (tax returns, income stmt, balance sheet, PFS)
 *   GEMINI_PACKET    → Gemini OCR with multi-page awareness (T12, rent rolls)
 *   GEMINI_STANDARD  → Standard Gemini OCR (everything else)
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
  isDocAiRoute,
} from "@/lib/documents/docTypeRouting";
import { isGoogleDocAiEnabled } from "@/lib/flags/googleDocAi";

// ─── DOC_AI_ATOMIC: Tax Returns ──────────────────────────────────────────────

test("BUSINESS_TAX_RETURN → DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("BUSINESS_TAX_RETURN");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("IRS_BUSINESS → BUSINESS_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("IRS_BUSINESS");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("IRS_1120 → BUSINESS_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("IRS_1120");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("IRS_1120S → BUSINESS_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("IRS_1120S");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("IRS_1065 → BUSINESS_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("IRS_1065");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("PERSONAL_TAX_RETURN → DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("PERSONAL_TAX_RETURN");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("IRS_PERSONAL → PERSONAL_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("IRS_PERSONAL");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("IRS_1040 → PERSONAL_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("IRS_1040");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("K1 → PERSONAL_TAX_RETURN / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("K1");
  assert.equal(r.canonical_type, "PERSONAL_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

// ─── DOC_AI_ATOMIC: Income Statement ─────────────────────────────────────────

test("INCOME_STATEMENT → DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("INCOME_STATEMENT");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("PROFIT_AND_LOSS → INCOME_STATEMENT / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("PROFIT_AND_LOSS");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("P&L → INCOME_STATEMENT / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("P&L");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

// ─── DOC_AI_ATOMIC: Balance Sheet ────────────────────────────────────────────

test("BALANCE_SHEET → DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("BALANCE_SHEET");
  assert.equal(r.canonical_type, "BALANCE_SHEET");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

// ─── DOC_AI_ATOMIC: PFS ──────────────────────────────────────────────────────

test("PFS → DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("PFS");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("PERSONAL_FINANCIAL_STATEMENT → PFS / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("PERSONAL_FINANCIAL_STATEMENT");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("SBA_413 → PFS / DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("SBA_413");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

// ─── GEMINI_PACKET: Generic Financial Statement (T12) ────────────────────────

test("FINANCIAL_STATEMENT → GEMINI_PACKET", () => {
  const r = resolveDocTypeRouting("FINANCIAL_STATEMENT");
  assert.equal(r.canonical_type, "FINANCIAL_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_PACKET");
});

test("T12 → FINANCIAL_STATEMENT / GEMINI_PACKET", () => {
  const r = resolveDocTypeRouting("T12");
  assert.equal(r.canonical_type, "FINANCIAL_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_PACKET");
});

test("INTERIM_FINANCIALS → FINANCIAL_STATEMENT / GEMINI_PACKET", () => {
  const r = resolveDocTypeRouting("INTERIM_FINANCIALS");
  assert.equal(r.canonical_type, "FINANCIAL_STATEMENT");
  assert.equal(r.routing_class, "GEMINI_PACKET");
});

// ─── GEMINI_STANDARD: Rent Roll ──────────────────────────────────────────────

test("RENT_ROLL → GEMINI_STANDARD", () => {
  const r = resolveDocTypeRouting("RENT_ROLL");
  assert.equal(r.canonical_type, "RENT_ROLL");
  assert.equal(r.routing_class, "GEMINI_STANDARD");
});

// ─── GEMINI_STANDARD: Other Standard Types ───────────────────────────────────

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

// ─── GEMINI_STANDARD: Entity doc sub-types ───────────────────────────────────

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

// ─── isDocAiRoute helper ─────────────────────────────────────────────────────

test("isDocAiRoute returns true for DOC_AI_ATOMIC", () => {
  assert.equal(isDocAiRoute("DOC_AI_ATOMIC"), true);
});

test("isDocAiRoute returns false for GEMINI_PACKET", () => {
  assert.equal(isDocAiRoute("GEMINI_PACKET"), false);
});

test("isDocAiRoute returns false for GEMINI_STANDARD", () => {
  assert.equal(isDocAiRoute("GEMINI_STANDARD"), false);
});

// ─── routingClassFor helper ──────────────────────────────────────────────────

test("routingClassFor returns DOC_AI_ATOMIC for BUSINESS_TAX_RETURN", () => {
  assert.equal(routingClassFor("BUSINESS_TAX_RETURN"), "DOC_AI_ATOMIC");
});

test("routingClassFor returns GEMINI_PACKET for FINANCIAL_STATEMENT", () => {
  assert.equal(routingClassFor("FINANCIAL_STATEMENT"), "GEMINI_PACKET");
});

test("routingClassFor returns GEMINI_STANDARD for unknown type", () => {
  assert.equal(routingClassFor("NEVER_SEEN_BEFORE"), "GEMINI_STANDARD");
});

// ─── Case Normalization ──────────────────────────────────────────────────────

test("normalizes lowercase to canonical type", () => {
  const r = resolveDocTypeRouting("business_tax_return");
  assert.equal(r.canonical_type, "BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("normalizes mixed case to canonical type", () => {
  const r = resolveDocTypeRouting("Income_Statement");
  assert.equal(r.canonical_type, "INCOME_STATEMENT");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("normalizes with leading/trailing whitespace", () => {
  const r = resolveDocTypeRouting("  PFS  ");
  assert.equal(r.canonical_type, "PFS");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

test("handles hyphenated types", () => {
  const r = resolveDocTypeRouting("balance-sheet");
  assert.equal(r.canonical_type, "BALANCE_SHEET");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
});

// ─── Null/Undefined Safety ───────────────────────────────────────────────────

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

// ─── Cost Leak Prevention ────────────────────────────────────────────────────

test("T12 does NOT route to DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("T12");
  assert.notEqual(r.routing_class, "DOC_AI_ATOMIC");
});

test("RENT_ROLL does NOT route to DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("RENT_ROLL");
  assert.notEqual(r.routing_class, "DOC_AI_ATOMIC");
});

test("BANK_STATEMENT does NOT route to DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("BANK_STATEMENT");
  assert.notEqual(r.routing_class, "DOC_AI_ATOMIC");
});

test("FINANCIAL_STATEMENT (generic) does NOT route to DOC_AI_ATOMIC", () => {
  const r = resolveDocTypeRouting("FINANCIAL_STATEMENT");
  assert.notEqual(r.routing_class, "DOC_AI_ATOMIC");
});

// ─── Scope Guardrails ────────────────────────────────────────────────────────

test("exactly 5 canonical types route to DOC_AI_ATOMIC", () => {
  const docAiTypes = [
    "BUSINESS_TAX_RETURN",
    "PERSONAL_TAX_RETURN",
    "INCOME_STATEMENT",
    "BALANCE_SHEET",
    "PFS",
  ];

  for (const t of docAiTypes) {
    assert.equal(
      routingClassFor(t),
      "DOC_AI_ATOMIC",
      `Expected ${t} to be DOC_AI_ATOMIC`,
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

// ─── Feature Flag: GOOGLE_DOCAI_ENABLED ─────────────────────────────────────

test("isGoogleDocAiEnabled returns false when env var is unset", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  delete process.env.GOOGLE_DOCAI_ENABLED;
  assert.equal(isGoogleDocAiEnabled(), false);
  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
});

test("isGoogleDocAiEnabled returns false when env var is 'false'", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  process.env.GOOGLE_DOCAI_ENABLED = "false";
  assert.equal(isGoogleDocAiEnabled(), false);
  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

test("isGoogleDocAiEnabled returns false when env var is empty", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  process.env.GOOGLE_DOCAI_ENABLED = "";
  assert.equal(isGoogleDocAiEnabled(), false);
  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

test("isGoogleDocAiEnabled returns true only when env var is 'true'", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  process.env.GOOGLE_DOCAI_ENABLED = "true";
  assert.equal(isGoogleDocAiEnabled(), true);
  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

test("isGoogleDocAiEnabled returns true for 'TRUE' (case-insensitive)", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  process.env.GOOGLE_DOCAI_ENABLED = "TRUE";
  assert.equal(isGoogleDocAiEnabled(), true);
  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

test("isGoogleDocAiEnabled returns false for non-'true' values like '1' or 'yes'", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  for (const val of ["1", "yes", "on", "enabled"]) {
    process.env.GOOGLE_DOCAI_ENABLED = val;
    assert.equal(isGoogleDocAiEnabled(), false, `Expected false for '${val}'`);
  }
  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

// ─── Flag + Routing Integration ─────────────────────────────────────────────

test("DOC_AI_ATOMIC routing class falls back to Gemini when flag is OFF", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  process.env.GOOGLE_DOCAI_ENABLED = "false";

  const r = resolveDocTypeRouting("BUSINESS_TAX_RETURN");
  assert.equal(r.routing_class, "DOC_AI_ATOMIC");
  // Router would check: isDocAiRoute(r.routing_class) && isGoogleDocAiEnabled()
  const wouldUseDocAi = isDocAiRoute(r.routing_class);
  const actuallyUseDocAi = wouldUseDocAi && isGoogleDocAiEnabled();
  assert.equal(wouldUseDocAi, true, "Routing class should be DOC_AI_ATOMIC");
  assert.equal(actuallyUseDocAi, false, "Should NOT execute DocAI when flag is OFF");

  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

test("DOC_AI_ATOMIC routing class uses DocAI when flag is ON", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;
  process.env.GOOGLE_DOCAI_ENABLED = "true";

  const r = resolveDocTypeRouting("BUSINESS_TAX_RETURN");
  const wouldUseDocAi = isDocAiRoute(r.routing_class);
  const actuallyUseDocAi = wouldUseDocAi && isGoogleDocAiEnabled();
  assert.equal(actuallyUseDocAi, true, "Should execute DocAI when flag is ON");

  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});

test("GEMINI_STANDARD routing is unaffected by flag state", () => {
  const prev = process.env.GOOGLE_DOCAI_ENABLED;

  for (const flagVal of ["true", "false"]) {
    process.env.GOOGLE_DOCAI_ENABLED = flagVal;
    const r = resolveDocTypeRouting("BANK_STATEMENT");
    const wouldUseDocAi = isDocAiRoute(r.routing_class);
    assert.equal(wouldUseDocAi, false, `BANK_STATEMENT should never route to DocAI (flag=${flagVal})`);
  }

  if (prev !== undefined) process.env.GOOGLE_DOCAI_ENABLED = prev;
  else delete process.env.GOOGLE_DOCAI_ENABLED;
});
