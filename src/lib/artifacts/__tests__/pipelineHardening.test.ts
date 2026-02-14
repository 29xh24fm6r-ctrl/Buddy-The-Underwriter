import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Phase 14 — Pipeline Hardening Governance Tests
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// BLOCKER B: processArtifact calls extractByDocType before materialize
// ---------------------------------------------------------------------------

test("processArtifact invokes extractByDocType BEFORE materializeFactsFromArtifacts", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");
  const extractIdx = src.indexOf("extractByDocType");
  const materializeIdx = src.indexOf("materializeFactsFromArtifacts");

  assert.ok(extractIdx > 0, "extractByDocType must appear in processArtifact.ts");
  assert.ok(materializeIdx > 0, "materializeFactsFromArtifacts must appear in processArtifact.ts");
  assert.ok(
    extractIdx < materializeIdx,
    `extractByDocType (pos ${extractIdx}) must come BEFORE materializeFactsFromArtifacts (pos ${materializeIdx})`,
  );
});

// ---------------------------------------------------------------------------
// BLOCKER B: isExtractEligibleDocType uses canonical types only
// ---------------------------------------------------------------------------

test("isExtractEligibleDocType canonical set — no synonyms", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");

  // Extract the set contents
  const setMatch = src.match(/EXTRACT_ELIGIBLE_DOC_TYPES\s*=\s*new\s+Set\(\[([^\]]+)\]/s);
  assert.ok(setMatch, "EXTRACT_ELIGIBLE_DOC_TYPES set must exist");

  const entries = setMatch[1].match(/"([^"]+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];

  // Must contain canonical types
  const requiredTypes = [
    "BUSINESS_TAX_RETURN",
    "PERSONAL_TAX_RETURN",
    "INCOME_STATEMENT",
    "BALANCE_SHEET",
    "RENT_ROLL",
    "PERSONAL_FINANCIAL_STATEMENT",
  ];

  for (const t of requiredTypes) {
    assert.ok(entries.includes(t), `Missing canonical type: ${t}`);
  }

  // Must NOT contain synonyms
  const forbidden = [
    "TAX_RETURN",
    "T12",
    "TRAILING_12",
    "OPERATING_STATEMENT",
    "FINANCIAL_STATEMENT",
    "PFS",
    "K1",
    "IRS_1040",
    "IRS_1120",
    "IRS_1065",
    "IRS_BUSINESS",
    "IRS_PERSONAL",
  ];

  for (const f of forbidden) {
    assert.ok(!entries.includes(f), `Synonym "${f}" must NOT be in EXTRACT_ELIGIBLE_DOC_TYPES`);
  }
});

// ---------------------------------------------------------------------------
// BLOCKER B: Extraction failure logs to ledger + Aegis
// ---------------------------------------------------------------------------

test("extraction failure paths emit ledger and Aegis events", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");

  // The extraction block should have both ledger and Aegis events on failure
  assert.ok(
    src.includes('eventKey: "extraction.failed"'),
    "Must emit extraction.failed ledger event",
  );
  assert.ok(
    src.includes('eventKey: "extraction.completed"'),
    "Must emit extraction.completed ledger event",
  );
  assert.ok(
    src.includes('"DOCUMENT_EXTRACT_FAILED"'),
    "Must emit DOCUMENT_EXTRACT_FAILED Aegis event",
  );
});

// ---------------------------------------------------------------------------
// Routing: BALANCE_SHEET in DOC_TYPES
// ---------------------------------------------------------------------------

test("BALANCE_SHEET is a valid DocumentType", () => {
  const src = readFile("src/lib/artifacts/classifyDocument.ts");
  assert.ok(
    src.includes('"BALANCE_SHEET"'),
    "BALANCE_SHEET must be in DOC_TYPES array",
  );
});

test("DocAI balance_sheet label maps to BALANCE_SHEET (not OTHER)", () => {
  const src = readFile("src/lib/artifacts/classifyDocument.ts");
  const match = src.match(/"balance_sheet"\s*:\s*"([^"]+)"/);
  assert.ok(match, "balance_sheet must be in DOCAI_LABEL_MAP");
  assert.equal(match[1], "BALANCE_SHEET", "balance_sheet must map to BALANCE_SHEET, not OTHER");
});

// ---------------------------------------------------------------------------
// Routing: classifyByRules has balance sheet keyword anchor
// ---------------------------------------------------------------------------

test("classifyByRules includes balance sheet keyword rule", () => {
  const src = readFile("src/lib/artifacts/classifyByRules.ts");
  assert.ok(
    src.includes("BALANCE_SHEET") && src.includes("balance"),
    "classifyByRules must have a BALANCE_SHEET keyword anchor",
  );
});

// ---------------------------------------------------------------------------
// Fix 3: Spread enqueue gated on facts ready
// ---------------------------------------------------------------------------

test("spread enqueue is gated on factsReady", () => {
  const src = readFile("src/lib/artifacts/processArtifact.ts");
  assert.ok(
    src.includes("factsReady"),
    "processArtifact must reference factsReady gating variable",
  );
  assert.ok(
    src.includes("spread.enqueue.skipped_no_facts"),
    "Must emit spread.enqueue.skipped_no_facts ledger event when facts not ready",
  );
});

// ---------------------------------------------------------------------------
// Fix 1: queueArtifact is awaited (not fire-and-forget)
// ---------------------------------------------------------------------------

test("queueArtifact is awaited in files/record route", () => {
  const src = readFile("src/app/api/deals/[dealId]/files/record/route.ts");
  // Must await, not fire-and-forget with .catch()
  assert.ok(
    src.includes("await queueArtifact("),
    "queueArtifact must be awaited",
  );
  assert.ok(
    src.includes("artifactQueued"),
    "Response must include artifactQueued status",
  );
});
