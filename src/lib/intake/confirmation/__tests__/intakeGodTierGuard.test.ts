/**
 * E1.2 — God Tier Intake CI Guards
 *
 * Outcome-based behavioral tests using computeDocBlockers() directly.
 * Source-string fallback guards only where runtime harness is impossible.
 *
 * Guards A-J: Outcome-based (call pure functions, assert results)
 * Guards K-L: Source-string fallback (grep route source)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDocBlockers,
  buildAmbiguousKeySet,
  computeAllBlockers,
  YEAR_REQUIRED_TYPES,
} from "../computeDocBlockers";
import type { ActiveDoc } from "../computeDocBlockers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<ActiveDoc> = {}): ActiveDoc {
  return {
    id: "test-doc",
    original_filename: "test.pdf",
    intake_status: "AUTO_CONFIRMED",
    quality_status: "PASSED",
    segmented: false,
    canonical_type: "BUSINESS_TAX_RETURN",
    doc_year: 2024,
    logical_key: "BTR|2024",
    ...overrides,
  };
}

const EMPTY_AMBIGUOUS = new Set<string>();

// ── Guard A: Segmentation gate blocks ────────────────────────────────────

test("Guard A: segmented=true produces 'segmented_parent' blocker", () => {
  const doc = makeDoc({ segmented: true });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    blockers.includes("segmented_parent"),
    `Expected "segmented_parent" in blockers, got: ${JSON.stringify(blockers)}`,
  );
});

// ── Guard B: Unclassified doc blocked ────────────────────────────────────

test("Guard B: canonical_type=null produces 'unclassified' blocker", () => {
  const doc = makeDoc({ canonical_type: null });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    blockers.includes("unclassified"),
    `Expected "unclassified" in blockers, got: ${JSON.stringify(blockers)}`,
  );
});

// ── Guard C: Missing year blocks for tax returns ─────────────────────────

test("Guard C: PTR with null doc_year produces 'missing_required_year'", () => {
  const doc = makeDoc({
    canonical_type: "PERSONAL_TAX_RETURN",
    doc_year: null,
  });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    blockers.includes("missing_required_year"),
    `Expected "missing_required_year" in blockers, got: ${JSON.stringify(blockers)}`,
  );
});

test("Guard C.1: BTR with null doc_year produces 'missing_required_year'", () => {
  const doc = makeDoc({
    canonical_type: "BUSINESS_TAX_RETURN",
    doc_year: null,
  });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    blockers.includes("missing_required_year"),
    `Expected "missing_required_year" for BTR without year`,
  );
});

test("Guard C.2: Non-tax type with null year does NOT produce 'missing_required_year'", () => {
  const doc = makeDoc({
    canonical_type: "BALANCE_SHEET",
    doc_year: null,
  });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    !blockers.includes("missing_required_year"),
    `BALANCE_SHEET should not require year`,
  );
});

// ── Guard D: Quality null blocks ─────────────────────────────────────────

test("Guard D: quality_status=null produces 'quality_not_passed'", () => {
  const doc = makeDoc({ quality_status: null });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    blockers.includes("quality_not_passed"),
    `Expected "quality_not_passed" for null quality_status`,
  );
});

test("Guard D.1: quality_status='FAILED' produces 'quality_not_passed'", () => {
  const doc = makeDoc({ quality_status: "FAILED" });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(
    blockers.includes("quality_not_passed"),
    `Expected "quality_not_passed" for FAILED quality_status`,
  );
});

// ── Guard E: Entity ambiguity detected ───────────────────────────────────

test("Guard E: unresolved entity-scoped doc with ambiguous key produces 'entity_ambiguous'", () => {
  const doc = makeDoc({
    logical_key: null,
    canonical_type: "PERSONAL_TAX_RETURN",
    doc_year: 2024,
  });
  // Simulate: two PTR 2024 docs without logical_key
  const ambiguousKeys = new Set(["PERSONAL_TAX_RETURN|2024"]);
  const blockers = computeDocBlockers(doc, ambiguousKeys);
  assert.ok(
    blockers.includes("entity_ambiguous"),
    `Expected "entity_ambiguous" in blockers`,
  );
});

test("Guard E.1: buildAmbiguousKeySet detects duplicate entity-scoped docs", () => {
  const docs = [
    makeDoc({ id: "a", canonical_type: "PERSONAL_TAX_RETURN", doc_year: 2024, logical_key: null }),
    makeDoc({ id: "b", canonical_type: "PERSONAL_TAX_RETURN", doc_year: 2024, logical_key: null }),
    makeDoc({ id: "c", canonical_type: "BALANCE_SHEET", doc_year: null, logical_key: null }),
  ];
  const keys = buildAmbiguousKeySet(docs);
  assert.ok(keys.has("PERSONAL_TAX_RETURN|2024"), "PTR|2024 should be ambiguous");
  assert.ok(!keys.has("BALANCE_SHEET|NA"), "BALANCE_SHEET is not entity-scoped");
});

// ── Guard F: Clean doc produces zero blockers ────────────────────────────

test("Guard F: fully clean doc produces zero blockers", () => {
  const doc = makeDoc(); // defaults: AUTO_CONFIRMED, PASSED, not segmented, classified, has year, has logical_key
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.deepEqual(
    blockers,
    [],
    `Clean doc should have no blockers, got: ${JSON.stringify(blockers)}`,
  );
});

test("Guard F.1: needs_confirmation for UPLOADED status", () => {
  const doc = makeDoc({ intake_status: "UPLOADED" });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(blockers.includes("needs_confirmation"));
});

test("Guard F.2: needs_confirmation for CLASSIFIED_PENDING_REVIEW", () => {
  const doc = makeDoc({ intake_status: "CLASSIFIED_PENDING_REVIEW" });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(blockers.includes("needs_confirmation"));
});

// ── Guard G: Golden corpus has >= 25 fixtures ────────────────────────────

test("Guard G: golden corpus has >= 25 fixtures across all corpus files", () => {
  const dir = resolve(__dirname, "../../matching/__tests__");

  const corpusFiles = [
    "goldenCorpus.test.ts",
    "goldenCorpus_v11.test.ts",
    "goldenCorpus_e12.test.ts",
  ];

  let totalFixtures = 0;
  for (const file of corpusFiles) {
    try {
      const src = readFileSync(resolve(dir, file), "utf-8");
      const matches = src.match(/test\("Golden #\d+/g);
      totalFixtures += matches?.length ?? 0;
    } catch {
      // File may not exist yet
    }
  }

  assert.ok(
    totalFixtures >= 25,
    `Expected >= 25 golden fixtures across corpus files, found ${totalFixtures}`,
  );
});

// ── Guard H: Entity-scoped golden fixtures exist ─────────────────────────

test("Guard H: golden corpus contains entity-scoped fixtures", () => {
  const dir = resolve(__dirname, "../../matching/__tests__");

  const corpusFiles = [
    "goldenCorpus.test.ts",
    "goldenCorpus_v11.test.ts",
    "goldenCorpus_e12.test.ts",
  ];

  let found = false;
  for (const file of corpusFiles) {
    try {
      const src = readFileSync(resolve(dir, file), "utf-8");
      if (src.includes("requiredEntityId")) {
        found = true;
        break;
      }
    } catch {
      // File may not exist yet
    }
  }

  assert.ok(
    found,
    "Golden corpus must contain entity-scoped fixtures (requiredEntityId)",
  );
});

// ── Guard I: YEAR_REQUIRED_TYPES includes PTR + BTR ──────────────────────

test("Guard I: YEAR_REQUIRED_TYPES includes PTR and BTR", () => {
  assert.ok(
    YEAR_REQUIRED_TYPES.has("PERSONAL_TAX_RETURN"),
    "YEAR_REQUIRED_TYPES must include PERSONAL_TAX_RETURN",
  );
  assert.ok(
    YEAR_REQUIRED_TYPES.has("BUSINESS_TAX_RETURN"),
    "YEAR_REQUIRED_TYPES must include BUSINESS_TAX_RETURN",
  );
});

// ── Guard J: computeAllBlockers produces correct summary ─────────────────

test("Guard J: computeAllBlockers summary counts match blocked docs", () => {
  const docs: ActiveDoc[] = [
    makeDoc({ id: "a", intake_status: "UPLOADED", quality_status: "PASSED" }),
    makeDoc({ id: "b", intake_status: "AUTO_CONFIRMED", quality_status: null }),
    makeDoc({ id: "c" }), // clean
  ];
  const { blocked_documents, summary } = computeAllBlockers(docs);

  assert.equal(blocked_documents.length, 2, "Should have 2 blocked docs");
  assert.equal(summary.needs_confirmation, 1, "1 needs_confirmation");
  assert.equal(summary.quality_not_passed, 1, "1 quality_not_passed");

  // Clean doc should not appear
  const cleanDoc = blocked_documents.find((d) => d.document_id === "c");
  assert.equal(cleanDoc, undefined, "Clean doc should not be in blocked list");
});

// ── Guard K (Source-String Fallback): Confirm route uses computeDocBlockers ──

test("Guard K: confirm/route.ts imports computeDocBlockers", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../app/api/deals/[dealId]/intake/confirm/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes("computeAllBlockers") || src.includes("computeDocBlockers"),
    "Confirm route must use computeDocBlockers or computeAllBlockers",
  );
});

// ── Guard L (Source-String Fallback): Confirm route returns confirmation_blocked ──

test("Guard L: confirm/route.ts returns 'confirmation_blocked' error", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../../app/api/deals/[dealId]/intake/confirm/route.ts"),
    "utf-8",
  );
  assert.ok(
    src.includes('"confirmation_blocked"'),
    "Confirm route must return 'confirmation_blocked' error on rejection",
  );
});

// ── Guard M: Multiple blockers can co-exist on single doc ────────────────

test("Guard M: doc with multiple issues produces multiple blockers", () => {
  const doc = makeDoc({
    intake_status: "UPLOADED",
    quality_status: null,
    segmented: true,
    canonical_type: null,
  });
  const blockers = computeDocBlockers(doc, EMPTY_AMBIGUOUS);
  assert.ok(blockers.includes("needs_confirmation"), "should have needs_confirmation");
  assert.ok(blockers.includes("quality_not_passed"), "should have quality_not_passed");
  assert.ok(blockers.includes("segmented_parent"), "should have segmented_parent");
  assert.ok(blockers.includes("unclassified"), "should have unclassified");
  assert.ok(blockers.length >= 4, `Expected >= 4 blockers, got ${blockers.length}`);
});
