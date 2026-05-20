import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

function readSource(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

const writeFact = readSource("src/lib/financialFacts/writeFact.ts");
const shared = readSource("src/lib/financialSpreads/extractors/shared.ts");
const extractFacts = readSource(
  "src/lib/financialSpreads/extractFactsFromDocument.ts",
);

// ---------------------------------------------------------------------------
// SPEC-EXTRACTION-PERIOD-INTEGRITY-1 guard tests
// ---------------------------------------------------------------------------

// Fix 1: sentinel date rejection

test("upsertDealFinancialFact rejects facts with sentinel period_end 1900-01-01", () => {
  assert.match(writeFact, /MIN_VALID_PERIOD_DATE/);
  assert.match(writeFact, /1990-01-01/);
  // The rejection check must be before the upsert
  const rejectIdx = writeFact.indexOf("invalid_period_date");
  const upsertIdx = writeFact.indexOf(".upsert(row");
  assert.ok(rejectIdx !== -1, "sentinel rejection not found");
  assert.ok(upsertIdx !== -1, "upsert not found");
  assert.ok(rejectIdx < upsertIdx, "sentinel rejection must come before upsert");
});

test("upsertDealFinancialFact rejects facts with period_end before 1990-01-01", () => {
  // The guard compares periodEnd <= MIN_VALID_PERIOD_DATE
  assert.match(writeFact, /periodEnd\s*<=\s*MIN_VALID_PERIOD_DATE/);
});

// Fix 2: documentPeriodEnd passed from Gemini metadata

test("extractFactsFromDocument passes documentPeriodEnd from Gemini metadata to writeFactsBatch", () => {
  assert.match(
    extractFacts,
    /documentPeriodEnd/,
    "documentPeriodEnd not found in extractFactsFromDocument",
  );
  // Must reference rawResponse.metadata.period_end
  assert.match(
    extractFacts,
    /rawResponse.*metadata.*period_end/s,
    "Gemini metadata period_end not referenced",
  );
  // Must pass documentPeriodEnd to writeFactsBatch call
  const writeCallIdx = extractFacts.indexOf("writeFactsBatch({");
  assert.ok(writeCallIdx !== -1);
  const writeCallBlock = extractFacts.slice(writeCallIdx, writeCallIdx + 500);
  assert.match(
    writeCallBlock,
    /documentPeriodEnd/,
    "documentPeriodEnd not passed to writeFactsBatch",
  );
});

// Fix 3: auto spread recompute

test("writeFactsBatch enqueues spread recompute after spread-affecting fact writes", () => {
  assert.match(
    shared,
    /enqueueSpreadRecompute/,
    "enqueueSpreadRecompute not found in writeFactsBatch",
  );
  // Should check INCOME_STATEMENT, BALANCE_SHEET, TAX_RETURN
  assert.match(shared, /INCOME_STATEMENT/);
  assert.match(shared, /BALANCE_SHEET/);
  assert.match(shared, /TAX_RETURN|BUSINESS_TAX_RETURN/);
  // Must be inside a try/catch (non-fatal)
  const enqueueIdx = shared.indexOf("enqueueSpreadRecompute");
  const tryBefore = shared.lastIndexOf("try {", enqueueIdx);
  const catchAfter = shared.indexOf("} catch", enqueueIdx);
  assert.ok(tryBefore !== -1 && catchAfter !== -1, "enqueueSpreadRecompute must be in try/catch");
  assert.ok(tryBefore < enqueueIdx && enqueueIdx < catchAfter);
});

test("writeFactsBatch only enqueues spread recompute when factsWritten > 0", () => {
  // The recompute must be gated on factsWritten > 0
  assert.match(shared, /factsWritten > 0/);
  // And the SPREAD_AFFECTING_TYPES check must be inside that gate
  const gateIdx = shared.indexOf("factsWritten > 0");
  const typeCheckIdx = shared.indexOf("SPREAD_AFFECTING_TYPES");
  assert.ok(gateIdx !== -1 && typeCheckIdx !== -1);
  assert.ok(gateIdx < typeCheckIdx, "fact-written gate must come before type check");
});
