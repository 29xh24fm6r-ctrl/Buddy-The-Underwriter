/**
 * processConfirmedIntake Match-Source CI Guards — Regression-Proof Invariants
 *
 * Ensures processConfirmedIntake preserves manual match authority by selecting
 * match_source and threading matchSource into runMatchForDocument.
 *
 * PROC-MATCHSOURCE-G1: select query includes match_source
 * PROC-MATCHSOURCE-G2: runMatchForDocument call includes matchSource referencing doc.match_source
 * PROC-MATCHSOURCE-G3: conditional checks for === "manual" (exact authority contract)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FILE_PATH = path.join(
  process.cwd(),
  "src/lib/intake/processing/processConfirmedIntake.ts",
);

function readSource(): string {
  return fs.readFileSync(FILE_PATH, "utf8");
}

// ─── PROC-MATCHSOURCE-G1: select query includes match_source ─────────────────

test("PROC-MATCHSOURCE-G1: processConfirmedIntake selects match_source from deal_documents", () => {
  const src = readSource();

  // The select() call loading confirmed docs must include match_source
  assert.ok(
    src.includes("match_source"),
    "processConfirmedIntake must select match_source from deal_documents",
  );

  // The ConfirmedDoc type must include match_source
  assert.ok(
    src.includes("match_source: string | null"),
    "ConfirmedDoc type must include match_source: string | null",
  );
});

// ─── PROC-MATCHSOURCE-G2: runMatchForDocument call includes matchSource ───────

test("PROC-MATCHSOURCE-G2: runMatchForDocument call includes matchSource referencing doc.match_source", () => {
  const src = readSource();

  // The matchSource param must be present in the runMatchForDocument call
  assert.ok(
    src.includes("matchSource:") && src.includes("doc.match_source"),
    "runMatchForDocument call must include matchSource derived from doc.match_source",
  );
});

// ─── PROC-MATCHSOURCE-G3: authority contract uses exact "manual" string ───────

test('PROC-MATCHSOURCE-G3: matchSource conditional checks for === "manual"', () => {
  const src = readSource();

  // Must check doc.match_source === "manual" (exact authority contract)
  assert.ok(
    src.includes('doc.match_source === "manual"'),
    'processConfirmedIntake must check doc.match_source === "manual" for authority bypass',
  );

  // Must pass "manual" as matchSource value (not any other string)
  assert.ok(
    src.includes('? "manual"'),
    'matchSource must be set to "manual" when doc.match_source is "manual"',
  );
});
