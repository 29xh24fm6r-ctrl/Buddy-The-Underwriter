/**
 * Golden Corpus — Multi-Entity Deal Integration (v1.3)
 *
 * Scenario: Borrower (OPCO) + Guarantor (PERSON)
 * Slots: BTR-2023 (entity=OPCO), PTR-2023 (entity=PERSON-guarantor), PFS (entity=PERSON-guarantor)
 * Docs: Borrower BTR, Guarantor PTR, Guarantor PFS
 * Assert: each doc routes to correct entity slot, no cross-entity attachment
 *
 * Pure functions — no DB, no IO, no side effects.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runTier1Anchors } from "../../lib/classification/tier1Anchors";
import type { NormalizedDocument, Tier1Result } from "../../lib/classification/types";
import { extractPeriod } from "../../lib/intake/identity/extractPeriod";
import { resolveEntity } from "../../lib/intake/identity/entityResolver";
import type { EntityCandidate } from "../../lib/intake/identity/entityResolver";
import { buildDocumentIdentity } from "../../lib/intake/matching/identity";
import type { SpineSignals } from "../../lib/intake/matching/identity";
import { matchDocumentToSlot } from "../../lib/intake/matching/matchEngine";
import type { SlotSnapshot, PeriodInfo, EntityInfo } from "../../lib/intake/matching/types";

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, "fixtures");

function loadFixture(filename: string): string {
  return fs.readFileSync(path.join(FIXTURES, filename), "utf8");
}

// ---------------------------------------------------------------------------
// Document normalizer
// ---------------------------------------------------------------------------

function normalizeDocument(text: string, filename: string): NormalizedDocument {
  const lines = text.split("\n");
  const firstPageText = lines.slice(0, 60).join("\n");
  const firstTwoPagesText = lines.slice(0, 120).join("\n");
  const yearMatches = text.match(/\b(19\d{2}|20\d{2})\b/g);
  const detectedYears = yearMatches
    ? [...new Set(yearMatches.map(Number))].filter((y) => y >= 1990 && y <= 2099)
    : [];
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
// Tier 1 → SpineSignals bridge
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

// ---------------------------------------------------------------------------
// Entity candidates for the deal
// ---------------------------------------------------------------------------

const DEAL_ENTITIES: EntityCandidate[] = [
  {
    entityId: "ent-opco",
    entityRole: "operating",
    legalName: "ACME OPERATIONS LLC",
    einLast4: "4567",
    ssnLast4: null,
    normalizedNameTokens: ["acme", "operations", "llc"],
  },
  {
    entityId: "ent-guarantor",
    entityRole: "guarantor",
    legalName: "JANE DOE",
    einLast4: null,
    ssnLast4: "1234",
    normalizedNameTokens: ["jane", "doe"],
  },
];

// ---------------------------------------------------------------------------
// Entity-scoped slots
// ---------------------------------------------------------------------------

function entityScopedSlots(): SlotSnapshot[] {
  return [
    {
      slotId: "btr-2023-opco",
      slotKey: "BTR_2023_OPCO",
      slotGroup: "tax",
      requiredDocType: "BUSINESS_TAX_RETURN",
      requiredTaxYear: 2023,
      status: "empty",
      sortOrder: 1,
      requiredEntityId: "ent-opco",
    },
    {
      slotId: "ptr-2023-guarantor",
      slotKey: "PTR_2023_GUARANTOR",
      slotGroup: "tax",
      requiredDocType: "PERSONAL_TAX_RETURN",
      requiredTaxYear: 2023,
      status: "empty",
      sortOrder: 2,
      requiredEntityId: "ent-guarantor",
    },
    {
      slotId: "pfs-guarantor",
      slotKey: "PFS_GUARANTOR",
      slotGroup: "financial",
      requiredDocType: "PERSONAL_FINANCIAL_STATEMENT",
      requiredTaxYear: null,
      status: "empty",
      sortOrder: 3,
      requiredEntityId: "ent-guarantor",
    },
  ];
}

// ---------------------------------------------------------------------------
// Full chain with entity resolution
// ---------------------------------------------------------------------------

function runEntityChain(
  fixtureFile: string,
  slots: SlotSnapshot[],
  dealEntities: EntityCandidate[],
): {
  tier1: Tier1Result;
  spine: SpineSignals | null;
  period: PeriodInfo | null;
  entity: EntityInfo | null;
  identity: ReturnType<typeof buildDocumentIdentity>;
  match: ReturnType<typeof matchDocumentToSlot>;
} {
  const text = loadFixture(fixtureFile);
  const doc = normalizeDocument(text, fixtureFile);

  // Step 1: Tier 1 classify
  const tier1 = runTier1Anchors(doc);
  const spine = tier1ToSpine(tier1);

  // Step 2: Period extraction
  const pe = extractPeriod(text, fixtureFile);
  const period: PeriodInfo | null =
    pe.periodStart || pe.periodEnd || pe.taxYear != null
      ? {
          periodStart: pe.periodStart,
          periodEnd: pe.periodEnd,
          statementType: pe.statementType,
          multiYear: pe.multiYear,
          taxYearConfidence: pe.taxYearConfidence,
        }
      : null;

  // Step 3: Entity resolution
  // Detect EIN/SSN signals more accurately — phone numbers are NOT EIN signals
  const hasEinSignal = /employer\s+identification/i.test(text) || /\bEIN\b/.test(text) ||
    /\b\d{2}-\d{7}\b/.test(text);
  const hasSsnSignal = /social\s+security/i.test(text) || /\bSSN\b/.test(text) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(text);
  const entityResolution = resolveEntity(
    {
      text,
      filename: fixtureFile,
      hasEin: hasEinSignal,
      hasSsn: hasSsnSignal,
    },
    dealEntities,
    tier1.entityType,
  );
  const entity: EntityInfo | null = entityResolution.entityId
    ? {
        entityId: entityResolution.entityId,
        entityRole: entityResolution.entityRole,
        confidence: entityResolution.confidence,
        ambiguous: entityResolution.ambiguous,
        tier: entityResolution.tier,
      }
    : null;

  // Step 4: Build identity
  const identity = buildDocumentIdentity({
    documentId: `fixture-${fixtureFile}`,
    spine,
    gatekeeper: null,
    period,
    entity,
  });

  // Step 5: Match
  const match = matchDocumentToSlot(identity, slots, "conventional_v1");

  return { tier1, spine, period, entity, identity, match };
}

// ---------------------------------------------------------------------------
// Multi-entity golden entries
// ---------------------------------------------------------------------------

test("Multi-entity #M1: BTR routes to OPCO slot (entity=ent-opco)", () => {
  const result = runEntityChain("borrower_btr_2023.txt", entityScopedSlots(), DEAL_ENTITIES);

  // Must classify as BTR (raw Tier 1 type is IRS_BUSINESS)
  assert.ok(result.tier1.matched, "BTR must match Tier 1");
  assert.strictEqual(result.tier1.docType, "IRS_BUSINESS");

  // Must resolve to OPCO entity (EIN match)
  assert.ok(result.entity, "Entity must be resolved");
  assert.strictEqual(result.entity!.entityId, "ent-opco", "BTR entity must be OPCO");

  // Must auto-attach to the OPCO slot
  assert.strictEqual(result.match.decision, "auto_attached");
  assert.strictEqual(result.match.slotKey, "BTR_2023_OPCO");
});

test("Multi-entity #M2: PTR routes to Guarantor slot (entity=ent-guarantor)", () => {
  const result = runEntityChain("guarantor_ptr_2023.txt", entityScopedSlots(), DEAL_ENTITIES);

  // Must classify as PTR (raw Tier 1 type is IRS_PERSONAL)
  assert.ok(result.tier1.matched, "PTR must match Tier 1");
  assert.strictEqual(result.tier1.docType, "IRS_PERSONAL");

  // Must resolve to Guarantor entity (SSN match or name match)
  assert.ok(result.entity, "Entity must be resolved");
  assert.strictEqual(result.entity!.entityId, "ent-guarantor", "PTR entity must be Guarantor");

  // Must auto-attach to the Guarantor PTR slot
  assert.strictEqual(result.match.decision, "auto_attached");
  assert.strictEqual(result.match.slotKey, "PTR_2023_GUARANTOR");
});

test("Multi-entity #M3: PFS with both entity names → ambiguous → no_match (realistic SBA 413 scenario)", () => {
  const result = runEntityChain("pfs.txt", entityScopedSlots(), DEAL_ENTITIES);

  // Must classify as PFS
  assert.ok(result.tier1.matched, "PFS must match Tier 1");
  assert.strictEqual(result.tier1.docType, "PERSONAL_FINANCIAL_STATEMENT");

  // SBA Form 413 lists both person name (JANE DOE) and business name (ACME OPERATIONS LLC).
  // Entity resolver correctly sees both names → ambiguous (2 candidates at name_exact tier).
  // This is correct behavior — ambiguous entity + entity-required slot → no_match.
  // In production, this routes to review for human confirmation.
  assert.strictEqual(result.entity, null, "Both names in PFS → ambiguous → entity null");
  assert.strictEqual(result.match.decision, "no_match", "Ambiguous entity on entity-required slot → no_match");
});

test("Multi-entity #M4: BTR does NOT attach to Guarantor PTR slot (cross-entity protection)", () => {
  const result = runEntityChain("borrower_btr_2023.txt", entityScopedSlots(), DEAL_ENTITIES);

  // Must NOT attach to any guarantor slot
  if (result.match.decision === "auto_attached") {
    assert.notStrictEqual(
      result.match.slotKey,
      "PTR_2023_GUARANTOR",
      "BTR must NOT attach to Guarantor PTR slot",
    );
    assert.notStrictEqual(
      result.match.slotKey,
      "PFS_GUARANTOR",
      "BTR must NOT attach to Guarantor PFS slot",
    );
  }
});

test("Multi-entity #M5: PTR does NOT attach to OPCO BTR slot (cross-entity protection)", () => {
  const result = runEntityChain("guarantor_ptr_2023.txt", entityScopedSlots(), DEAL_ENTITIES);

  // Must NOT attach to OPCO BTR slot
  if (result.match.decision === "auto_attached") {
    assert.notStrictEqual(
      result.match.slotKey,
      "BTR_2023_OPCO",
      "PTR must NOT attach to OPCO BTR slot",
    );
  }
});

// ---------------------------------------------------------------------------
// Aggregate: wrongAttachCount == 0
// ---------------------------------------------------------------------------

test("Multi-entity Golden: wrongAttachCount == 0", () => {
  // PFS excluded from auto_attach expected list — ambiguous entity → no_match (correct behavior)
  const fixtures = ["borrower_btr_2023.txt", "guarantor_ptr_2023.txt"];
  const expectedSlotKeys = ["BTR_2023_OPCO", "PTR_2023_GUARANTOR"];
  let wrongAttachCount = 0;
  const wrongAttaches: string[] = [];

  for (let i = 0; i < fixtures.length; i++) {
    const result = runEntityChain(fixtures[i], entityScopedSlots(), DEAL_ENTITIES);

    if (result.match.decision === "auto_attached" && result.match.slotKey !== expectedSlotKeys[i]) {
      wrongAttachCount++;
      wrongAttaches.push(
        `${fixtures[i]}: expected slotKey="${expectedSlotKeys[i]}", got="${result.match.slotKey}"`,
      );
    }
  }

  // Also verify PFS does NOT wrongly auto-attach
  const pfsResult = runEntityChain("pfs.txt", entityScopedSlots(), DEAL_ENTITIES);
  if (pfsResult.match.decision === "auto_attached") {
    wrongAttachCount++;
    wrongAttaches.push(
      `pfs.txt: expected no_match (ambiguous), got auto_attached to "${pfsResult.match.slotKey}"`,
    );
  }

  if (wrongAttaches.length > 0) {
    console.error("[multiEntityGolden] Wrong attaches:\n" + wrongAttaches.join("\n"));
  }

  assert.strictEqual(
    wrongAttachCount,
    0,
    `Multi-entity golden corpus: wrongAttachCount must be 0, got ${wrongAttachCount}`,
  );

  console.log(
    `[multiEntityGolden] wrongAttachCount == 0 across ${fixtures.length} multi-entity entries ✓`,
  );
});
