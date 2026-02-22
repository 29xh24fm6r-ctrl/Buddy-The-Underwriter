/**
 * Naming Golden Corpus — Pure Function Tests (v1.3)
 *
 * Validates deterministic naming outcomes for known scenarios.
 * Pure function tests — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { deriveDealName, type AnchorDocCandidate } from "../deriveDealName";
import { deriveDocumentDisplayName, type DeriveDocumentDisplayNameInput } from "../deriveDocumentDisplayName";

// ---------------------------------------------------------------------------
// Deal Name Golden Entries
// ---------------------------------------------------------------------------

type DealGolden = {
  label: string;
  candidates: AnchorDocCandidate[];
  expectedName: string | null;
  expectedMethod: "derived" | null;
};

const DEAL_GOLDEN_CORPUS: DealGolden[] = [
  {
    label: "#N1: Individual borrower (John Smith) — PTR 2023",
    candidates: [
      { documentType: "PERSONAL_TAX_RETURN", docYear: 2023, entityName: "John Smith", confidence: 0.95 },
    ],
    expectedName: "John Smith \u2014 PTR 2023",
    expectedMethod: "derived",
  },
  {
    label: "#N2: LLC borrower (ABC Holdings LLC) — BTR 2023",
    candidates: [
      { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "ABC Holdings LLC", confidence: 0.92 },
    ],
    expectedName: "ABC Holdings LLC \u2014 BTR 2023",
    expectedMethod: "derived",
  },
  {
    label: "#N3: Multi-entity borrower — BTR wins over PTR",
    candidates: [
      { documentType: "PERSONAL_TAX_RETURN", docYear: 2023, entityName: "Jane Doe", confidence: 0.95 },
      { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "Doe Enterprises", confidence: 0.90 },
    ],
    expectedName: "Doe Enterprises \u2014 BTR 2023",
    expectedMethod: "derived",
  },
  {
    label: "#N4: BTR latest year (2024 vs 2023) — latest wins",
    candidates: [
      { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "Acme 2023", confidence: 0.95 },
      { documentType: "BUSINESS_TAX_RETURN", docYear: 2024, entityName: "Acme 2024", confidence: 0.90 },
    ],
    expectedName: "Acme 2024 \u2014 BTR 2024",
    expectedMethod: "derived",
  },
  {
    label: "#N5: No classified docs → null (fallback path)",
    candidates: [],
    expectedName: null,
    expectedMethod: null,
  },
  {
    label: "#N6: Only non-anchor docs → null (no anchor found)",
    candidates: [
      { documentType: "BANK_STATEMENT", docYear: 2024, entityName: null, confidence: 0.95 },
      { documentType: "LEASE", docYear: null, entityName: "Tenant Corp", confidence: 0.90 },
    ],
    expectedName: null,
    expectedMethod: null,
  },
  {
    label: "#N7: PFS only with entity name → entity name alone",
    candidates: [
      { documentType: "PFS", docYear: null, entityName: "Robert Chen", confidence: 0.88 },
    ],
    expectedName: "Robert Chen",
    expectedMethod: "derived",
  },
  {
    label: "#N8: BTR no entity name, has year → 'Deal — BTR Year'",
    candidates: [
      { documentType: "BUSINESS_TAX_RETURN", docYear: 2024, entityName: null, confidence: 0.92 },
    ],
    expectedName: "Deal \u2014 BTR 2024",
    expectedMethod: "derived",
  },
];

for (const entry of DEAL_GOLDEN_CORPUS) {
  test(`Deal Naming Golden ${entry.label}`, () => {
    const result = deriveDealName(entry.candidates);
    assert.strictEqual(
      result.dealName,
      entry.expectedName,
      `${entry.label}: expected="${entry.expectedName}", got="${result.dealName}"`,
    );
    assert.strictEqual(
      result.method,
      entry.expectedMethod,
      `${entry.label}: expected method="${entry.expectedMethod}", got="${result.method}"`,
    );
  });
}

// ---------------------------------------------------------------------------
// Document Display Name Golden Entries
// ---------------------------------------------------------------------------

type DocGolden = {
  label: string;
  input: DeriveDocumentDisplayNameInput;
  expectedName: string;
};

const DOC_GOLDEN_CORPUS: DocGolden[] = [
  {
    label: "#D1: BTR 2023 with entity → 'Business Tax Return — Acme Corp (2023)'",
    input: {
      documentType: "BUSINESS_TAX_RETURN",
      docYear: 2023,
      entityName: "Acme Corp",
      classificationConfidence: 0.95,
      originalFilename: "1120S_2023.pdf",
    },
    expectedName: "Business Tax Return \u2014 Acme Corp (2023)",
  },
  {
    label: "#D2: PTR 2024 with entity → 'Personal Tax Return — John Doe (2024)'",
    input: {
      documentType: "PERSONAL_TAX_RETURN",
      docYear: 2024,
      entityName: "John Doe",
      classificationConfidence: 0.92,
      originalFilename: "1040_2024.pdf",
    },
    expectedName: "Personal Tax Return \u2014 John Doe (2024)",
  },
  {
    label: "#D3: PFS no year → 'Personal Financial Statement — Jane Smith'",
    input: {
      documentType: "PFS",
      docYear: null,
      entityName: "Jane Smith",
      classificationConfidence: 0.88,
      originalFilename: "pfs_jane.pdf",
    },
    expectedName: "Personal Financial Statement \u2014 Jane Smith",
  },
];

for (const entry of DOC_GOLDEN_CORPUS) {
  test(`Doc Naming Golden ${entry.label}`, () => {
    const result = deriveDocumentDisplayName(entry.input);
    assert.strictEqual(
      result.displayName,
      entry.expectedName,
      `${entry.label}: expected="${entry.expectedName}", got="${result.displayName}"`,
    );
    assert.strictEqual(result.method, "derived");
  });
}

// ---------------------------------------------------------------------------
// Schema guards
// ---------------------------------------------------------------------------

test("deriveDealName never returns empty string (returns null for fallback path)", () => {
  // Empty candidates
  const r1 = deriveDealName([]);
  assert.ok(r1.dealName === null, "Empty candidates must return null, not empty string");

  // Non-anchor candidates
  const r2 = deriveDealName([
    { documentType: "BANK_STATEMENT", docYear: 2024, entityName: null, confidence: 0.95 },
  ]);
  assert.ok(r2.dealName === null, "Non-anchor candidates must return null, not empty string");
});

test("deriveDealName with whitespace-only entity treats as null", () => {
  const r = deriveDealName([
    { documentType: "BUSINESS_TAX_RETURN", docYear: 2023, entityName: "   ", confidence: 0.90 },
  ]);
  // Whitespace entity → treated as null → "Deal — BTR 2023"
  assert.strictEqual(r.dealName, "Deal \u2014 BTR 2023");
});
