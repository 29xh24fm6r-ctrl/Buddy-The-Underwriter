/**
 * Golden Corpus — Intake Integration Suite (v1.3)
 *
 * End-to-end pure-function chain test:
 *   1. normalizeDocument(text, filename)
 *   2. runTier1Anchors(doc)
 *   3. runTier2Structural(doc) (if Tier 1 miss)
 *   4. extractPeriod(text, filename)
 *   5. buildDocumentIdentity(signals)
 *   6. matchDocumentToSlot(identity, slots)
 *
 * Pure functions — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runTier1Anchors } from "../../lib/classification/tier1Anchors";
import { runTier2Structural } from "../../lib/classification/tier2Structural";
import type { NormalizedDocument, Tier1Result, Tier2Result } from "../../lib/classification/types";
import { extractPeriod } from "../../lib/intake/identity/extractPeriod";
import { buildDocumentIdentity } from "../../lib/intake/matching/identity";
import type { SpineSignals } from "../../lib/intake/matching/identity";
import { matchDocumentToSlot } from "../../lib/intake/matching/matchEngine";
import type { SlotSnapshot, PeriodInfo } from "../../lib/intake/matching/types";

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES, filename), "utf8");
}

// ---------------------------------------------------------------------------
// NormalizedDocument builder
// ---------------------------------------------------------------------------

function normalizeDocument(text: string, filename: string): NormalizedDocument {
  const lines = text.split("\n");
  const firstPageText = lines.slice(0, 60).join("\n");
  const firstTwoPagesText = lines.slice(0, 120).join("\n");

  // Detect years (4-digit numbers between 1990 and 2099)
  const yearMatches = text.match(/\b(19\d{2}|20\d{2})\b/g);
  const detectedYears = yearMatches
    ? [...new Set(yearMatches.map(Number))].filter((y) => y >= 1990 && y <= 2099)
    : [];

  // Simple table detection (lines with multiple dollar amounts or tab-separated values)
  const hasTableLikeStructure =
    (text.match(/\$[\d,]+/g)?.length ?? 0) >= 3 ||
    (text.match(/\t/g)?.length ?? 0) >= 5 ||
    (text.match(/\.{3,}/g)?.length ?? 0) >= 3;

  return {
    artifactId: `fixture-${filename}`,
    filename,
    mimeType: "text/plain",
    pageCount: 1,
    firstPageText,
    firstTwoPagesText,
    fullText: text,
    detectedYears,
    hasTableLikeStructure,
  };
}

// ---------------------------------------------------------------------------
// Classification → SpineSignals bridge
// ---------------------------------------------------------------------------

function tier1ToSpine(r: Tier1Result): SpineSignals | null {
  if (!r.matched || !r.docType) return null;
  return {
    docType: r.docType,
    confidence: r.confidence,
    spineTier: "tier1_anchor",
    taxYear: r.taxYear,
    entityType: r.entityType,
    formNumbers: r.formNumbers,
    evidence: r.evidence.map((e) => ({
      type: e.type,
      anchorId: e.anchorId,
      matchedText: e.matchedText,
      confidence: e.confidence,
    })),
  };
}

function tier2ToSpine(r: Tier2Result): SpineSignals | null {
  if (!r.matched || !r.docType) return null;
  return {
    docType: r.docType,
    confidence: r.confidence,
    spineTier: "tier2_structural",
    taxYear: null, // Tier 2 doesn't extract year
    entityType: null, // Tier 2 doesn't extract entity type
    formNumbers: null,
    evidence: r.evidence.map((e) => ({
      type: e.type,
      anchorId: e.anchorId,
      matchedText: e.matchedText,
      confidence: e.confidence,
    })),
  };
}

// ---------------------------------------------------------------------------
// PeriodExtraction → PeriodInfo bridge
// ---------------------------------------------------------------------------

function periodToPeriodInfo(pe: ReturnType<typeof extractPeriod>): PeriodInfo | null {
  if (!pe.periodStart && !pe.periodEnd && pe.taxYear == null) return null;
  return {
    periodStart: pe.periodStart,
    periodEnd: pe.periodEnd,
    statementType: pe.statementType,
    multiYear: pe.multiYear,
    taxYearConfidence: pe.taxYearConfidence,
  };
}

// ---------------------------------------------------------------------------
// Standard slot sets
// ---------------------------------------------------------------------------

function makeSlot(
  overrides: Partial<SlotSnapshot> & Pick<SlotSnapshot, "slotId" | "slotKey" | "requiredDocType">,
): SlotSnapshot {
  return {
    slotGroup: "default",
    requiredTaxYear: null,
    status: "empty",
    sortOrder: 0,
    ...overrides,
  };
}

function standardDealSlots(): SlotSnapshot[] {
  return [
    makeSlot({ slotId: "btr-2023", slotKey: "BTR_2023", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 1 }),
    makeSlot({ slotId: "btr-2024", slotKey: "BTR_2024", requiredDocType: "BUSINESS_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 2 }),
    makeSlot({ slotId: "ptr-2023", slotKey: "PTR_2023", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2023, slotGroup: "tax", sortOrder: 3 }),
    makeSlot({ slotId: "ptr-2024", slotKey: "PTR_2024", requiredDocType: "PERSONAL_TAX_RETURN", requiredTaxYear: 2024, slotGroup: "tax", sortOrder: 4 }),
    makeSlot({ slotId: "pfs-1", slotKey: "PFS_1", requiredDocType: "PERSONAL_FINANCIAL_STATEMENT", slotGroup: "financial", sortOrder: 5 }),
    makeSlot({ slotId: "articles-1", slotKey: "ARTICLES_1", requiredDocType: "ARTICLES", slotGroup: "legal", sortOrder: 6 }),
    makeSlot({ slotId: "sba-1919-1", slotKey: "SBA_1919_1", requiredDocType: "SBA_APPLICATION", slotGroup: "sba", sortOrder: 7 }),
    makeSlot({ slotId: "voided-check-1", slotKey: "VOIDED_CHECK_1", requiredDocType: "VOIDED_CHECK", slotGroup: "misc", sortOrder: 8 }),
  ];
}

// ---------------------------------------------------------------------------
// Full chain runner
// ---------------------------------------------------------------------------

type ChainResult = {
  tier1: Tier1Result;
  tier2: Tier2Result | null;
  spine: SpineSignals | null;
  period: PeriodInfo | null;
  identity: ReturnType<typeof buildDocumentIdentity>;
  match: ReturnType<typeof matchDocumentToSlot>;
};

function runFullChain(fixtureFile: string, slots: SlotSnapshot[]): ChainResult {
  const text = loadFixture(fixtureFile);
  const doc = normalizeDocument(text, fixtureFile);

  // Step 1: Tier 1 anchor classification
  const tier1 = runTier1Anchors(doc);

  // Step 2: Tier 2 structural (if Tier 1 miss)
  let tier2: Tier2Result | null = null;
  if (!tier1.matched) {
    tier2 = runTier2Structural(doc);
  }

  // Step 3: Build spine signals
  const spine = tier1.matched ? tier1ToSpine(tier1) : (tier2 ? tier2ToSpine(tier2) : null);

  // Step 4: Extract period
  const periodExtraction = extractPeriod(text, fixtureFile);
  const period = periodToPeriodInfo(periodExtraction);

  // Step 5: Build identity
  const identity = buildDocumentIdentity({
    documentId: `fixture-${fixtureFile}`,
    spine,
    gatekeeper: null,
    period,
    entity: null, // No entity resolution in basic chain (see multiEntityDeal test)
  });

  // Step 6: Match to slots
  const match = matchDocumentToSlot(identity, slots, "conventional_v1");

  return { tier1, tier2, spine, period, identity, match };
}

// ---------------------------------------------------------------------------
// Golden expectations
// ---------------------------------------------------------------------------

type IntegrationExpectation = {
  label: string;
  fixture: string;
  expectedTier: "tier1" | "tier2" | "none";
  expectedDocType: string;
  expectedDecision: "auto_attached" | "routed_to_review" | "no_match";
  expectedSlotKey: string | null;
};

const INTEGRATION_CORPUS: IntegrationExpectation[] = [
  {
    label: "#I1: BTR 2023 (Form 1120) → Tier 1, auto_attached to BTR_2023",
    fixture: "borrower_btr_2023.txt",
    expectedTier: "tier1",
    expectedDocType: "IRS_BUSINESS", // Tier 1 raw type; equivalence map → BUSINESS_TAX_RETURN
    expectedDecision: "auto_attached",
    expectedSlotKey: "BTR_2023",
  },
  {
    label: "#I2: PTR 2023 (Form 1040) → Tier 1, auto_attached to PTR_2023",
    fixture: "guarantor_ptr_2023.txt",
    expectedTier: "tier1",
    expectedDocType: "IRS_PERSONAL", // Tier 1 raw type; equivalence map → PERSONAL_TAX_RETURN
    expectedDecision: "auto_attached",
    expectedSlotKey: "PTR_2023",
  },
  {
    label: "#I3: Articles of Incorporation → Tier 1, auto_attached to ARTICLES_1",
    fixture: "articles_of_incorp.txt",
    expectedTier: "tier1",
    expectedDocType: "ARTICLES",
    expectedDecision: "auto_attached",
    expectedSlotKey: "ARTICLES_1",
  },
  {
    label: "#I4: SBA Form 1919 → Tier 1, auto_attached to SBA_1919_1",
    fixture: "sba_1919.txt",
    expectedTier: "tier1",
    expectedDocType: "SBA_APPLICATION", // SBA 1919 = application, not generic SBA_FORM
    expectedDecision: "auto_attached",
    expectedSlotKey: "SBA_1919_1",
  },
  {
    label: "#I5: PFS (SBA 413) → Tier 1, auto_attached to PFS_1",
    fixture: "pfs.txt",
    expectedTier: "tier1",
    expectedDocType: "PERSONAL_FINANCIAL_STATEMENT",
    expectedDecision: "auto_attached",
    expectedSlotKey: "PFS_1",
  },
  {
    label: "#I6: Multi-year bank statement → classified, no_match (multi-year period blocks)",
    fixture: "multi_year_bank_stmt.txt",
    expectedTier: "none", // Bank statements may not match Tier 1/2
    expectedDocType: "OTHER",
    expectedDecision: "no_match",
    expectedSlotKey: null,
  },
];

// ---------------------------------------------------------------------------
// Tests: each golden entry
// ---------------------------------------------------------------------------

for (const entry of INTEGRATION_CORPUS) {
  test(`Integration Golden ${entry.label}`, () => {
    const result = runFullChain(entry.fixture, standardDealSlots());

    // Verify classification tier
    if (entry.expectedTier === "tier1") {
      assert.ok(result.tier1.matched, `${entry.label}: expected Tier 1 match`);
      assert.strictEqual(
        result.tier1.docType,
        entry.expectedDocType,
        `${entry.label}: Tier 1 docType mismatch`,
      );
    } else if (entry.expectedTier === "tier2") {
      assert.ok(!result.tier1.matched, `${entry.label}: expected Tier 1 miss`);
      assert.ok(result.tier2?.matched, `${entry.label}: expected Tier 2 match`);
      assert.strictEqual(
        result.tier2!.docType,
        entry.expectedDocType,
        `${entry.label}: Tier 2 docType mismatch`,
      );
    }

    // Verify match decision
    assert.strictEqual(
      result.match.decision,
      entry.expectedDecision,
      `${entry.label}: expected decision="${entry.expectedDecision}", got="${result.match.decision}" (reason: ${result.match.reason})`,
    );

    // Verify slot key if auto_attached
    if (entry.expectedDecision === "auto_attached" && entry.expectedSlotKey) {
      assert.strictEqual(
        result.match.slotKey,
        entry.expectedSlotKey,
        `${entry.label}: expected slotKey="${entry.expectedSlotKey}", got="${result.match.slotKey}"`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Aggregate: wrongAttachCount == 0
// ---------------------------------------------------------------------------

test("Integration Golden Corpus: wrongAttachCount == 0", () => {
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (const entry of INTEGRATION_CORPUS) {
    const result = runFullChain(entry.fixture, standardDealSlots());

    if (
      result.match.decision === "auto_attached" &&
      entry.expectedDecision === "auto_attached" &&
      result.match.slotKey !== entry.expectedSlotKey
    ) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: expected slotKey="${entry.expectedSlotKey}", got="${result.match.slotKey}"`,
      );
    }

    if (
      result.match.decision === "auto_attached" &&
      entry.expectedDecision !== "auto_attached"
    ) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${entry.label}: expected "${entry.expectedDecision}", got auto_attached to "${result.match.slotKey}"`,
      );
    }
  }

  if (wrongAttaches.length > 0) {
    console.error("[integrationGolden] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Integration golden corpus: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[integrationGolden] wrongAttachCount == 0 across ${INTEGRATION_CORPUS.length} integration entries ✓`,
  );
});

// ---------------------------------------------------------------------------
// Chain invariant: deterministic classification → deterministic authority
// ---------------------------------------------------------------------------

test("Chain invariant: Tier 1 classification → deterministic authority in identity", () => {
  const result = runFullChain("borrower_btr_2023.txt", standardDealSlots());
  assert.strictEqual(result.identity.authority, "deterministic");
});

test("Chain invariant: spine docType propagates to identity effectiveDocType", () => {
  const result = runFullChain("borrower_btr_2023.txt", standardDealSlots());
  assert.strictEqual(result.identity.effectiveDocType, "IRS_BUSINESS"); // raw Tier 1 type
  assert.strictEqual(result.identity.rawDocType, "IRS_BUSINESS");
});

test("Chain invariant: Tier 1 taxYear propagates to identity", () => {
  const result = runFullChain("borrower_btr_2023.txt", standardDealSlots());
  assert.strictEqual(result.identity.taxYear, 2023);
});

test("Chain invariant: Tier 1 entityType propagates to identity", () => {
  const result = runFullChain("borrower_btr_2023.txt", standardDealSlots());
  assert.strictEqual(result.identity.entityType, "business");
});
