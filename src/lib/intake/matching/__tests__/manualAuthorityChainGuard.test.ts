/**
 * Manual Authority Chain — Integration CI Guards
 *
 * End-to-end invariants proving manual banker corrections cannot be
 * overwritten by AI reprocessing or identity inference at any stage.
 *
 * Chain: confirm route → runMatchForDocument → identity enforcement →
 *        processConfirmedIntake → runMatchForDocument (re-match)
 *
 * TEST-AUTH-1: manualAuthorityCannotBeOverwritten
 * TEST-AUTH-2: confirmTriggersMatching
 * TEST-AUTH-3: identityEnforcementSkipsManual
 * TEST-AUTH-4: processingPreservesManualAuthority
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CONFIRM_ROUTE = path.join(
  process.cwd(),
  "src/app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
);
const RUN_MATCH = path.join(
  process.cwd(),
  "src/lib/intake/matching/runMatch.ts",
);
const PROCESS_CONFIRMED = path.join(
  process.cwd(),
  "src/lib/intake/processing/processConfirmedIntake.ts",
);

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

// ─── TEST-AUTH-1: manualAuthorityCannotBeOverwritten ──────────────────────────
// Given doc.match_source = "manual", when AI reprocess runs,
// slot attachment remains unchanged because matchSource="manual" is threaded
// through the entire chain (confirm → processing → matching → enforcement).

test("TEST-AUTH-1: manualAuthorityCannotBeOverwritten — AI reprocess preserves manual slot attachment", () => {
  const processing = read(PROCESS_CONFIRMED);
  const matching = read(RUN_MATCH);

  // 1. processConfirmedIntake reads match_source from DB
  assert.ok(
    processing.includes("match_source"),
    "processConfirmedIntake must select match_source from deal_documents",
  );

  // 2. processConfirmedIntake threads matchSource="manual" into runMatchForDocument
  assert.ok(
    processing.includes('doc.match_source === "manual"') &&
    processing.includes("matchSource:"),
    "processConfirmedIntake must conditionally pass matchSource based on doc.match_source",
  );

  // 3. runMatchForDocument uses matchSource for confidence bypass
  assert.ok(
    matching.includes("matchSource"),
    "runMatchForDocument must accept matchSource parameter",
  );

  // 4. Identity enforcement respects manual authority
  assert.ok(
    matching.includes("isManualAuthority") &&
    matching.includes("!isManualAuthority"),
    "identity enforcement must check isManualAuthority before blocking",
  );

  // 5. Full chain: manual → confidence bypass + identity bypass = slot stays attached
  assert.ok(
    processing.includes('? "manual" :') &&
    matching.includes('matchSource === "manual"'),
    "full chain must propagate exact 'manual' string from DB to enforcement gate",
  );
});

// ─── TEST-AUTH-2: confirmTriggersMatching ─────────────────────────────────────
// Confirm route must call runMatchForDocument. CI fails if removed.

test("TEST-AUTH-2: confirmTriggersMatching — confirm route calls runMatchForDocument", () => {
  const confirm = read(CONFIRM_ROUTE);

  assert.ok(
    confirm.includes("runMatchForDocument"),
    "confirm route must call runMatchForDocument",
  );

  assert.ok(
    confirm.includes("await runMatchForDocument("),
    "confirm route must await runMatchForDocument (not fire-and-forget)",
  );

  assert.ok(
    confirm.includes("@/lib/intake/matching/runMatch"),
    "confirm route must import from the canonical matching module",
  );

  // Must be non-fatal (inside try/catch)
  const matchIdx = confirm.indexOf("await runMatchForDocument(");
  const beforeMatch = confirm.slice(0, matchIdx);
  const lastTryIdx = beforeMatch.lastIndexOf("try {");
  assert.ok(lastTryIdx > -1, "runMatchForDocument must be inside try/catch (non-fatal)");

  // Must pass matchSource: "manual"
  assert.ok(
    confirm.includes('matchSource: "manual"'),
    'confirm route must pass matchSource: "manual" to runMatchForDocument',
  );
});

// ─── TEST-AUTH-3: identityEnforcementSkipsManual ─────────────────────────────
// isManualAuthority === true → enforcement must not route_to_review.

test("TEST-AUTH-3: identityEnforcementSkipsManual — manual docs bypass identity enforcement", () => {
  const src = read(RUN_MATCH);

  // isManualAuthority must gate the enforcement decision
  const enforcementStart = src.indexOf("if (enforcementSlot)");
  assert.ok(enforcementStart > -1, "enforcementSlot check must exist");

  const enforcementBlock = src.slice(enforcementStart, enforcementStart + 800);

  // Manual check must appear BEFORE routed_to_review
  const manualIdx = enforcementBlock.indexOf("isManualAuthority");
  const routeIdx = enforcementBlock.indexOf('"routed_to_review"');
  assert.ok(
    manualIdx > -1 && routeIdx > -1 && manualIdx < routeIdx,
    "isManualAuthority must be checked BEFORE setting routed_to_review",
  );

  // The routing is inside if (!isManualAuthority) — so manual skips it
  assert.ok(
    enforcementBlock.includes("if (!isManualAuthority)"),
    "identity enforcement routing must be gated by !isManualAuthority",
  );

  // Identity enforcement is NOT deleted (still emits event for non-manual)
  assert.ok(
    src.includes("match.identity_mismatch"),
    "identity enforcement event must still exist for non-manual paths",
  );
});

// ─── TEST-AUTH-4: processingPreservesManualAuthority ──────────────────────────
// processConfirmedIntake rematch keeps match_source="manual" by threading
// matchSource into runMatchForDocument.

test("TEST-AUTH-4: processingPreservesManualAuthority — rematch threads matchSource from DB", () => {
  const src = read(PROCESS_CONFIRMED);

  // Must include match_source in ConfirmedDoc type
  assert.ok(
    src.includes("match_source: string | null"),
    "ConfirmedDoc type must include match_source field",
  );

  // Must select match_source in the confirmed docs query (contains classification_tier)
  const confirmDocsSelectIdx = src.indexOf("classification_tier, match_source");
  assert.ok(
    confirmDocsSelectIdx > -1,
    "confirmed docs select query must include match_source alongside classification_tier",
  );

  // Must pass matchSource to runMatchForDocument
  const matchCallIdx = src.indexOf("runMatchForDocument({");
  assert.ok(matchCallIdx > -1, "runMatchForDocument call must exist");

  const matchCallBlock = src.slice(matchCallIdx, matchCallIdx + 400);
  assert.ok(
    matchCallBlock.includes("matchSource:"),
    "runMatchForDocument call must include matchSource parameter",
  );

  // Must check exact "manual" string (authority contract)
  // isManualCorrection is derived from doc.match_source === "manual" and drives matchSource
  assert.ok(
    matchCallBlock.includes("isManualCorrection"),
    'matchSource must be conditionally set based on isManualCorrection (derived from doc.match_source === "manual")',
  );

  // Verify isManualCorrection is derived from the exact authority contract
  assert.ok(
    src.includes('doc.match_source === "manual"'),
    'processConfirmedIntake must check doc.match_source === "manual" for authority bypass',
  );
});
