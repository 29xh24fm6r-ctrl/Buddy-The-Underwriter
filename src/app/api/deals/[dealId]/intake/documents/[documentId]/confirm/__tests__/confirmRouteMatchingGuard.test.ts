/**
 * Confirm Route Matching CI Guards — Regression-Proof Invariants
 *
 * Ensures the confirm route always invokes the matching engine after
 * successful document confirmation, so Core Documents reflects the
 * attachment immediately (not deferred to background processing).
 *
 * CONFIRM-MATCH-G1: route file imports/calls runMatchForDocument
 * CONFIRM-MATCH-G2: matching call is inside try/catch (non-fatal)
 * CONFIRM-MATCH-G3: gatekeeper signal includes taxYear from effectiveTaxYear
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
);

function readRoute(): string {
  return fs.readFileSync(ROUTE_PATH, "utf8");
}

// ─── CONFIRM-MATCH-G1: route imports and calls runMatchForDocument ────────────

test("CONFIRM-MATCH-G1: confirm route imports and calls runMatchForDocument", () => {
  const src = readRoute();

  assert.ok(
    src.includes("runMatchForDocument"),
    "confirm route must reference runMatchForDocument for slot matching after confirmation",
  );

  assert.ok(
    src.includes("@/lib/intake/matching/runMatch"),
    "confirm route must import from @/lib/intake/matching/runMatch",
  );

  assert.ok(
    src.includes("await runMatchForDocument("),
    "confirm route must await runMatchForDocument (not fire-and-forget)",
  );
});

// ─── CONFIRM-MATCH-G2: matching call is non-fatal (try/catch) ─────────────────

test("CONFIRM-MATCH-G2: matching call is wrapped in try/catch (non-fatal)", () => {
  const src = readRoute();

  // The matching block must be wrapped in try/catch
  // Verify by checking that "runMatchForDocument" appears inside a try block
  const matchIdx = src.indexOf("await runMatchForDocument(");
  assert.ok(matchIdx > -1, "runMatchForDocument call must exist");

  // Find the nearest preceding 'try {' before the match call
  const beforeMatch = src.slice(0, matchIdx);
  const lastTryIdx = beforeMatch.lastIndexOf("try {");
  assert.ok(
    lastTryIdx > -1,
    "runMatchForDocument must be inside a try block (non-fatal matching)",
  );

  // Find the corresponding catch after the match call
  const afterMatch = src.slice(matchIdx);
  const catchIdx = afterMatch.indexOf("catch");
  assert.ok(
    catchIdx > -1,
    "runMatchForDocument try block must have a catch handler",
  );

  // Verify non-fatal pattern: console.warn in the catch
  assert.ok(
    src.includes("non-fatal"),
    "matching error handler must be annotated as non-fatal",
  );
});

// ─── CONFIRM-MATCH-G3: gatekeeper signal includes taxYear ─────────────────────

test("CONFIRM-MATCH-G3: gatekeeper signal includes taxYear from effectiveTaxYear", () => {
  const src = readRoute();

  // The gatekeeper object passed to runMatchForDocument must include taxYear
  assert.ok(
    src.includes("taxYear: effectiveTaxYear"),
    "gatekeeper signal must include taxYear derived from effectiveTaxYear",
  );

  // Must set confidence to 1.0 (human-confirmed)
  assert.ok(
    src.includes("confidence: 1.0"),
    "gatekeeper signal must have confidence: 1.0 for human-confirmed docs",
  );

  // Must include effectiveDocType
  assert.ok(
    src.includes("effectiveDocType: effectiveCanonicalType"),
    "gatekeeper signal must include effectiveDocType from effectiveCanonicalType",
  );
});
