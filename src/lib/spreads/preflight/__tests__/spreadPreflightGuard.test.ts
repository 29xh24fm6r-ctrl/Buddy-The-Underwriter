/**
 * E2 — Spread Preflight CI Guards
 *
 * Outcome-based behavioral tests using computePreflightBlockers() and
 * extraction validators directly. Source-string fallback only where
 * runtime harness is impossible.
 *
 * Guards A–L: Preflight blocker computation
 * Guards M–Q: Extraction quality validators
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  computePreflightBlockers,
  EXTRACT_ELIGIBLE_TYPES,
  CONFIRMED_PHASES,
  HARD_BLOCKER_CODES,
} from "../computePreflightBlockers";
import {
  validateBalanceSheet,
  validateIncomeStatement,
  validateTaxReturn,
  validateExtractionQuality,
  BS_BALANCE_TOLERANCE,
} from "../validateExtractedFinancials";
import type { PreflightInput, PreflightBlocker } from "../types";
import type { FactForValidation } from "../validateExtractedFinancials";
import { computeIntakeSnapshotHash } from "@/lib/intake/confirmation/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    intakePhase: "CONFIRMED_READY_FOR_PROCESSING",
    storedSnapshotHash: "abc123", // will be overridden for hash-match tests
    activeDocs: [],
    extractionHeartbeatDocIds: new Set<string>(),
    spreadsEnabled: true,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<PreflightInput["activeDocs"][0]> = {}) {
  return {
    id: "doc-1",
    canonical_type: "BALANCE_SHEET",
    doc_year: 2024,
    logical_key: "BS|2024",
    extraction_quality_status: null as string | null,
    ...overrides,
  };
}

function findBlocker(
  blockers: PreflightBlocker[],
  code: string,
): PreflightBlocker | undefined {
  return blockers.find((b) => b.code === code);
}

// ── Guard A: Null intakePhase → UNKNOWN_FAILSAFE ─────────────────────

test("Guard A: null intakePhase produces UNKNOWN_FAILSAFE", () => {
  const blockers = computePreflightBlockers(
    makeInput({ intakePhase: null }),
  );
  assert.ok(
    findBlocker(blockers, "UNKNOWN_FAILSAFE"),
    `Expected UNKNOWN_FAILSAFE, got: ${JSON.stringify(blockers)}`,
  );
});

// ── Guard B: BULK_UPLOADED → INTAKE_NOT_CONFIRMED ────────────────────

test("Guard B: BULK_UPLOADED phase produces INTAKE_NOT_CONFIRMED", () => {
  const blockers = computePreflightBlockers(
    makeInput({ intakePhase: "BULK_UPLOADED" }),
  );
  assert.ok(
    findBlocker(blockers, "INTAKE_NOT_CONFIRMED"),
    `Expected INTAKE_NOT_CONFIRMED, got: ${JSON.stringify(blockers)}`,
  );
});

test("Guard B.1: CLASSIFIED_PENDING_CONFIRMATION produces INTAKE_NOT_CONFIRMED", () => {
  const blockers = computePreflightBlockers(
    makeInput({ intakePhase: "CLASSIFIED_PENDING_CONFIRMATION" }),
  );
  assert.ok(findBlocker(blockers, "INTAKE_NOT_CONFIRMED"));
});

// ── Guard C: Null snapshot hash → INTAKE_SNAPSHOT_HASH_MISMATCH ──────

test("Guard C: null storedSnapshotHash produces INTAKE_SNAPSHOT_HASH_MISMATCH", () => {
  const blockers = computePreflightBlockers(
    makeInput({ storedSnapshotHash: null }),
  );
  assert.ok(
    findBlocker(blockers, "INTAKE_SNAPSHOT_HASH_MISMATCH"),
    `Expected INTAKE_SNAPSHOT_HASH_MISMATCH, got: ${JSON.stringify(blockers)}`,
  );
});

// ── Guard D: Hash mismatch → INTAKE_SNAPSHOT_HASH_MISMATCH ───────────

test("Guard D: mismatched snapshot hash produces INTAKE_SNAPSHOT_HASH_MISMATCH", () => {
  const doc = makeDoc({ logical_key: "BS|2024" });
  const blockers = computePreflightBlockers(
    makeInput({
      storedSnapshotHash: "definitely_wrong_hash",
      activeDocs: [doc],
    }),
  );
  assert.ok(
    findBlocker(blockers, "INTAKE_SNAPSHOT_HASH_MISMATCH"),
    `Expected INTAKE_SNAPSHOT_HASH_MISMATCH for hash mismatch`,
  );
});

// ── Guard E: Confirmed + matching hash → no INTAKE blockers ──────────

test("Guard E: confirmed phase with valid hash produces no INTAKE blockers", () => {
  // With empty docs list, no hash recomputation happens (no sealable docs)
  // and the stored hash presence alone satisfies the gate
  const blockers = computePreflightBlockers(
    makeInput({
      intakePhase: "CONFIRMED_READY_FOR_PROCESSING",
      storedSnapshotHash: "some_hash",
      activeDocs: [],
    }),
  );
  assert.ok(
    !findBlocker(blockers, "INTAKE_NOT_CONFIRMED"),
    "Should NOT have INTAKE_NOT_CONFIRMED",
  );
  assert.ok(
    !findBlocker(blockers, "INTAKE_SNAPSHOT_HASH_MISMATCH"),
    "Should NOT have INTAKE_SNAPSHOT_HASH_MISMATCH",
  );
});

test("Guard E.1: PROCESSING_COMPLETE is a valid confirmed phase", () => {
  const blockers = computePreflightBlockers(
    makeInput({ intakePhase: "PROCESSING_COMPLETE" }),
  );
  assert.ok(!findBlocker(blockers, "INTAKE_NOT_CONFIRMED"));
});

// ── Guard F: Missing extraction heartbeat → EXTRACTION_NOT_READY ─────

test("Guard F: doc without heartbeat produces EXTRACTION_NOT_READY", () => {
  const doc = makeDoc({ id: "doc-no-hb", canonical_type: "BALANCE_SHEET" });
  const blockers = computePreflightBlockers(
    makeInput({
      activeDocs: [doc],
      extractionHeartbeatDocIds: new Set(), // no heartbeats
    }),
  );
  assert.ok(
    findBlocker(blockers, "EXTRACTION_NOT_READY"),
    `Expected EXTRACTION_NOT_READY`,
  );
  const blocker = findBlocker(blockers, "EXTRACTION_NOT_READY")!;
  assert.ok(blocker.documentIds?.includes("doc-no-hb"));
});

test("Guard F.1: doc WITH heartbeat does NOT produce EXTRACTION_NOT_READY", () => {
  const doc = makeDoc({ id: "doc-has-hb", canonical_type: "BALANCE_SHEET" });
  const blockers = computePreflightBlockers(
    makeInput({
      activeDocs: [doc],
      extractionHeartbeatDocIds: new Set(["doc-has-hb"]),
    }),
  );
  assert.ok(!findBlocker(blockers, "EXTRACTION_NOT_READY"));
});

test("Guard F.2: non-extract-eligible doc type does NOT trigger EXTRACTION_NOT_READY", () => {
  const doc = makeDoc({ id: "doc-other", canonical_type: "INSURANCE" });
  const blockers = computePreflightBlockers(
    makeInput({
      activeDocs: [doc],
      extractionHeartbeatDocIds: new Set(), // no heartbeats
    }),
  );
  assert.ok(
    !findBlocker(blockers, "EXTRACTION_NOT_READY"),
    "INSURANCE is not extract-eligible — should not trigger EXTRACTION_NOT_READY",
  );
});

// ── Guard G: EXTRACTION_NOT_READY is transient ───────────────────────

test("Guard G: EXTRACTION_NOT_READY blocker has transient=true", () => {
  const doc = makeDoc({ id: "doc-x", canonical_type: "INCOME_STATEMENT" });
  const blockers = computePreflightBlockers(
    makeInput({
      activeDocs: [doc],
      extractionHeartbeatDocIds: new Set(),
    }),
  );
  const blocker = findBlocker(blockers, "EXTRACTION_NOT_READY");
  assert.ok(blocker, "Expected EXTRACTION_NOT_READY");
  assert.equal(blocker!.transient, true, "EXTRACTION_NOT_READY must be transient");
});

// ── Guard H: SUSPECT extraction → EXTRACTION_SUSPECT (not transient) ─

test("Guard H: SUSPECT quality produces EXTRACTION_SUSPECT", () => {
  const doc = makeDoc({
    id: "suspect-doc",
    extraction_quality_status: "SUSPECT",
  });
  const blockers = computePreflightBlockers(
    makeInput({ activeDocs: [doc] }),
  );
  assert.ok(
    findBlocker(blockers, "EXTRACTION_SUSPECT"),
    `Expected EXTRACTION_SUSPECT`,
  );
  const blocker = findBlocker(blockers, "EXTRACTION_SUSPECT")!;
  assert.ok(blocker.documentIds?.includes("suspect-doc"));
  assert.notEqual(blocker.transient, true, "EXTRACTION_SUSPECT must NOT be transient");
});

// ── Guard I: spreadsEnabled=false → SPREADS_DISABLED_BY_FLAG ─────────

test("Guard I: spreadsEnabled=false produces SPREADS_DISABLED_BY_FLAG", () => {
  const blockers = computePreflightBlockers(
    makeInput({ spreadsEnabled: false }),
  );
  assert.ok(findBlocker(blockers, "SPREADS_DISABLED_BY_FLAG"));
});

// ── Guard J: Clean input → zero blockers ─────────────────────────────

test("Guard J: fully clean input produces zero blockers", () => {
  const blockers = computePreflightBlockers(
    makeInput({
      intakePhase: "CONFIRMED_READY_FOR_PROCESSING",
      storedSnapshotHash: "some_hash",
      activeDocs: [], // no docs = no extraction required
      extractionHeartbeatDocIds: new Set(),
      spreadsEnabled: true,
    }),
  );
  assert.deepEqual(
    blockers,
    [],
    `Clean input should have zero blockers, got: ${JSON.stringify(blockers)}`,
  );
});

// ── Guard K: EXTRACT_ELIGIBLE_TYPES includes canonical set ───────────

test("Guard K: EXTRACT_ELIGIBLE_TYPES includes all canonical extract types", () => {
  const required = [
    "BUSINESS_TAX_RETURN",
    "PERSONAL_TAX_RETURN",
    "INCOME_STATEMENT",
    "BALANCE_SHEET",
    "RENT_ROLL",
    "PERSONAL_FINANCIAL_STATEMENT",
    "PERSONAL_INCOME",
    "SCHEDULE_K1",
  ];
  for (const t of required) {
    assert.ok(
      EXTRACT_ELIGIBLE_TYPES.has(t),
      `EXTRACT_ELIGIBLE_TYPES must include ${t}`,
    );
  }
});

// ── Guard L: Preflight does NOT check slot counts ────────────────────

test("Guard L: computePreflightBlockers source has no slot-related logic", () => {
  const src = readFileSync(
    resolve(__dirname, "../computePreflightBlockers.ts"),
    "utf-8",
  );
  // Preflight must NEVER re-validate intake — no slot counting
  assert.ok(
    !src.includes("SLOTS_NOT_VALIDATED"),
    "Preflight must NOT contain SLOTS_NOT_VALIDATED blocker",
  );
  assert.ok(
    !src.includes("REQUIRED_DOCS_MISSING"),
    "Preflight must NOT contain REQUIRED_DOCS_MISSING blocker",
  );
  assert.ok(
    !src.includes("validatedSlotCount"),
    "Preflight must NOT reference slot validation",
  );
});

// ── Guard M: BS with matching assets/liabilities → PASSED ────────────

test("Guard M: balanced balance sheet → PASSED", () => {
  const facts: FactForValidation[] = [
    { fact_key: "TOTAL_ASSETS", fact_value_num: 1_000_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "TOTAL_LIABILITIES", fact_value_num: 600_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "NET_WORTH", fact_value_num: 400_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
  ];
  const result = validateBalanceSheet(facts);
  assert.equal(result.status, "PASSED");
});

// ── Guard N: BS with >5% imbalance → SUSPECT ────────────────────────

test("Guard N: imbalanced balance sheet → SUSPECT", () => {
  const facts: FactForValidation[] = [
    { fact_key: "TOTAL_ASSETS", fact_value_num: 1_000_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "TOTAL_LIABILITIES", fact_value_num: 300_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
    { fact_key: "NET_WORTH", fact_value_num: 400_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
  ];
  // 1M vs 700K = 30% off
  const result = validateBalanceSheet(facts);
  assert.equal(result.status, "SUSPECT");
  assert.equal(result.reason_code, "BS_IMBALANCE");
});

// ── Guard O: IS with no revenue/income/expense → SUSPECT ─────────────

test("Guard O: income statement with no financial signals → SUSPECT", () => {
  const facts: FactForValidation[] = [
    { fact_key: "ENTITY_NAME", fact_value_num: null, fact_value_text: "Acme Corp", fact_type: "TAX_RETURN" },
  ];
  const result = validateIncomeStatement(facts);
  assert.equal(result.status, "SUSPECT");
  assert.equal(result.reason_code, "IS_NO_FINANCIAL_SIGNALS");
});

test("Guard O.1: income statement with revenue → PASSED", () => {
  const facts: FactForValidation[] = [
    { fact_key: "REVENUE", fact_value_num: 500_000, fact_value_text: null, fact_type: "FINANCIAL_ANALYSIS" },
  ];
  const result = validateIncomeStatement(facts);
  assert.equal(result.status, "PASSED");
});

// ── Guard P: Tax return with no year → SUSPECT ──────────────────────

test("Guard P: tax return with no year → SUSPECT", () => {
  const facts: FactForValidation[] = [
    { fact_key: "ENTITY_NAME", fact_value_num: null, fact_value_text: "Acme Corp", fact_type: "TAX_RETURN" },
  ];
  const result = validateTaxReturn(facts);
  assert.equal(result.status, "SUSPECT");
  assert.equal(result.reason_code, "TAX_MISSING_YEAR");
});

test("Guard P.1: tax return with year + entity → PASSED", () => {
  const facts: FactForValidation[] = [
    { fact_key: "TAX_YEAR", fact_value_num: 2024, fact_value_text: null, fact_type: "TAX_RETURN" },
    { fact_key: "ENTITY_NAME", fact_value_num: null, fact_value_text: "Acme Corp", fact_type: "TAX_RETURN" },
  ];
  const result = validateTaxReturn(facts);
  assert.equal(result.status, "PASSED");
});

// ── Guard Q: Insufficient data → PASSED (not SUSPECT) ───────────────

test("Guard Q: BS with only assets (no liabilities) → PASSED", () => {
  const facts: FactForValidation[] = [
    { fact_key: "TOTAL_ASSETS", fact_value_num: 1_000_000, fact_value_text: null, fact_type: "BALANCE_SHEET" },
  ];
  const result = validateBalanceSheet(facts);
  assert.equal(
    result.status,
    "PASSED",
    "Insufficient data must produce PASSED, not SUSPECT",
  );
});

test("Guard Q.1: empty facts for IS → SUSPECT (no signals at all)", () => {
  const result = validateIncomeStatement([]);
  assert.equal(result.status, "SUSPECT");
});

test("Guard Q.2: unknown doc type → PASSED", () => {
  const result = validateExtractionQuality("INSURANCE", []);
  assert.equal(result.status, "PASSED");
});

// ── Guard R: BS_BALANCE_TOLERANCE is 5% ──────────────────────────────

test("Guard R: BS_BALANCE_TOLERANCE is 0.05 (5%)", () => {
  assert.equal(BS_BALANCE_TOLERANCE, 0.05);
});

// ── Guard S: CONFIRMED_PHASES includes all valid phases ──────────────

test("Guard S: CONFIRMED_PHASES includes correct set", () => {
  assert.ok(CONFIRMED_PHASES.has("CONFIRMED_READY_FOR_PROCESSING"));
  assert.ok(CONFIRMED_PHASES.has("PROCESSING_COMPLETE"));
  assert.ok(CONFIRMED_PHASES.has("PROCESSING_COMPLETE_WITH_ERRORS"));
  assert.ok(!CONFIRMED_PHASES.has("BULK_UPLOADED"));
  assert.ok(!CONFIRMED_PHASES.has("CLASSIFIED_PENDING_CONFIRMATION"));
});

// ── Guard T: Multiple blockers can co-exist ──────────────────────────

test("Guard T: multiple blockers co-exist on single input", () => {
  const doc = makeDoc({
    id: "multi-blocker-doc",
    canonical_type: "BALANCE_SHEET",
    extraction_quality_status: "SUSPECT",
  });
  const blockers = computePreflightBlockers(
    makeInput({
      intakePhase: "BULK_UPLOADED",
      storedSnapshotHash: null,
      activeDocs: [doc],
      extractionHeartbeatDocIds: new Set(),
      spreadsEnabled: false,
    }),
  );
  assert.ok(findBlocker(blockers, "INTAKE_NOT_CONFIRMED"));
  assert.ok(findBlocker(blockers, "INTAKE_SNAPSHOT_HASH_MISMATCH"));
  assert.ok(findBlocker(blockers, "EXTRACTION_NOT_READY"));
  assert.ok(findBlocker(blockers, "EXTRACTION_SUSPECT"));
  assert.ok(findBlocker(blockers, "SPREADS_DISABLED_BY_FLAG"));
  assert.ok(blockers.length >= 5, `Expected >= 5 blockers, got ${blockers.length}`);
});

// ══════════════════════════════════════════════════════════════════════
// E2-C — Structural vs Execution Gate Separation Guards
// These guards enforce the permanent architectural contract:
//   Preflight = structural gate (hard blockers only)
//   Processor = execution gate (extraction, prereqs, retry)
// ══════════════════════════════════════════════════════════════════════

// ── Guard U: Extraction-only blockers → NOT hard blockers ─────────────

test("Guard U: EXTRACTION_NOT_READY is NOT in HARD_BLOCKER_CODES", () => {
  assert.ok(
    !HARD_BLOCKER_CODES.has("EXTRACTION_NOT_READY"),
    "EXTRACTION_NOT_READY is an execution-layer condition — must NOT be a hard blocker",
  );
});

test("Guard U.1: EXTRACTION_SUSPECT is NOT in HARD_BLOCKER_CODES", () => {
  assert.ok(
    !HARD_BLOCKER_CODES.has("EXTRACTION_SUSPECT"),
    "EXTRACTION_SUSPECT is an execution-layer condition — must NOT be a hard blocker",
  );
});

// ── Guard V: Structural blockers → ARE hard blockers ──────────────────

test("Guard V: all structural integrity codes are hard blockers", () => {
  assert.ok(HARD_BLOCKER_CODES.has("INTAKE_NOT_CONFIRMED"));
  assert.ok(HARD_BLOCKER_CODES.has("INTAKE_SNAPSHOT_HASH_MISMATCH"));
  assert.ok(HARD_BLOCKER_CODES.has("SPREADS_DISABLED_BY_FLAG"));
  assert.ok(HARD_BLOCKER_CODES.has("UNKNOWN_FAILSAFE"));
});

// ── Guard W: HARD_BLOCKER_CODES size is CI-locked ─────────────────────

test("Guard W: HARD_BLOCKER_CODES contains exactly 4 entries", () => {
  assert.equal(
    HARD_BLOCKER_CODES.size,
    4,
    `HARD_BLOCKER_CODES must have exactly 4 entries (structural integrity only), got ${HARD_BLOCKER_CODES.size}`,
  );
});

// ── Guard X: Execution-only blockers produce warnings, not failures ───

test("Guard X: input with only extraction blockers still computes them (observability)", () => {
  const doc = makeDoc({
    id: "extraction-only-doc",
    canonical_type: "BALANCE_SHEET",
    logical_key: null, // not sealable → excluded from hash computation
  });
  // Compute the correct hash for an empty sealable set (doc has no logical_key)
  const correctHash = computeIntakeSnapshotHash([]);
  const blockers = computePreflightBlockers(
    makeInput({
      intakePhase: "CONFIRMED_READY_FOR_PROCESSING",
      storedSnapshotHash: correctHash,
      activeDocs: [doc],
      extractionHeartbeatDocIds: new Set(), // no heartbeat → EXTRACTION_NOT_READY
      spreadsEnabled: true,
    }),
  );
  // The pure computation still returns blockers (for observability)
  assert.ok(
    findBlocker(blockers, "EXTRACTION_NOT_READY"),
    "EXTRACTION_NOT_READY must still be computed for observability",
  );
  // But none of them are hard blockers
  const hardBlockers = blockers.filter((b) => HARD_BLOCKER_CODES.has(b.code));
  assert.equal(
    hardBlockers.length,
    0,
    "Extraction-only input must produce zero hard blockers",
  );
});
