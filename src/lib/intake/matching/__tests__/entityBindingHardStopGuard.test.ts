/**
 * Entity Binding Hard-Stop CI Guards — Regression-Proof Invariants
 *
 * Ensures cross-entity misattachment prevention cannot regress.
 *
 * GUARD-33: runMatch filters unbound entity-scoped slots in multi-entity deals
 * GUARD-34: ledger token "match.entity_binding_required" exists in runMatch
 * GUARD-35: processing-status surfaces entity_binding_required fields
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MATCHING = path.join(process.cwd(), "src/lib/intake/matching");
const PROCESSING_STATUS = path.join(
  process.cwd(),
  "src/app/api/deals/[dealId]/intake/processing-status",
);

function readMatch(file: string): string {
  return fs.readFileSync(path.join(MATCHING, file), "utf8");
}

// ─── GUARD-33: runMatch filters unbound entity-scoped slots ──────────────────

test("GUARD-33: runMatch filters unbound entity-scoped slots in multi-entity deals", () => {
  const src = readMatch("runMatch.ts");

  // Must import ENTITY_SCOPED_DOC_TYPES
  assert.ok(
    src.includes("ENTITY_SCOPED_DOC_TYPES"),
    "runMatch.ts must reference ENTITY_SCOPED_DOC_TYPES for entity-binding hard-stop",
  );

  // Must check requiredEntityId == null for filtering
  assert.ok(
    src.includes("requiredEntityId == null") || src.includes("requiredEntityId === null"),
    "runMatch.ts must check requiredEntityId == null to filter unbound slots",
  );

  // Must reference entity count / multi-entity detection
  assert.ok(
    src.includes("hasMultiEntity") || src.includes("entityCount"),
    "runMatch.ts must detect multi-entity deals for entity-binding hard-stop",
  );

  // Must contain the slot filtering logic
  assert.ok(
    src.includes("filteredSlotCount"),
    "runMatch.ts must track filtered slot count for audit trail",
  );
});

// ─── GUARD-34: ledger token "match.entity_binding_required" ─────────────────

test("GUARD-34: runMatch emits match.entity_binding_required ledger event", () => {
  const src = readMatch("runMatch.ts");

  assert.ok(
    src.includes('"match.entity_binding_required"'),
    'runMatch.ts must emit "match.entity_binding_required" ledger event kind',
  );

  // Must set requiresHumanReview: true on this event
  const eventStart = src.indexOf('"match.entity_binding_required"');
  const eventBlock = src.slice(eventStart, eventStart + 500);
  assert.ok(
    eventBlock.includes("requiresHumanReview: true"),
    "match.entity_binding_required event must set requiresHumanReview: true",
  );
});

// ─── GUARD-35: processing-status surfaces entity_binding_required ────────────

test("GUARD-35: processing-status surfaces entity_binding_required fields", () => {
  const src = fs.readFileSync(
    path.join(PROCESSING_STATUS, "route.ts"),
    "utf8",
  );

  assert.ok(
    src.includes("entity_binding_required"),
    "processing-status route must include entity_binding_required field",
  );

  assert.ok(
    src.includes("unbound_entity_scoped_slot_count"),
    "processing-status route must include unbound_entity_scoped_slot_count field",
  );

  assert.ok(
    src.includes("entity_binding_required_reasons"),
    "processing-status route must include entity_binding_required_reasons field",
  );

  // Must use canonical entity binding check (via helper or direct import)
  assert.ok(
    src.includes("ENTITY_SCOPED_DOC_TYPES") || src.includes("getEntityBindingStatus"),
    "processing-status route must use ENTITY_SCOPED_DOC_TYPES or canonical getEntityBindingStatus helper",
  );
});
