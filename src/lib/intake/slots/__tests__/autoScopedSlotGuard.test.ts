/**
 * Phase T — Auto-Scoped Slot Generation + Readiness Blocking CI Guards
 *
 * Structural invariants ensuring:
 * - Entity-scoped slots are generated already bound (correct by construction)
 * - Readiness fails closed when entity binding is incomplete
 * - Canonical helper is the single source of truth
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Phase T — Auto-Scoped Slot Generation + Readiness Blocking", () => {
  test("Guard T-01: ensureDeterministicSlots maps required_entity_id + required_entity_role into upsert rows", () => {
    const src = readSource(
      "src/lib/intake/slots/ensureDeterministicSlots.ts",
    );
    assert.ok(
      src.includes("required_entity_id: def.required_entity_id") &&
      src.includes("required_entity_role: def.required_entity_role"),
      "Guard T-01: upsert row mapping must include required_entity_id and required_entity_role from slot definitions",
    );
  });

  test("Guard T-02: ensureDeterministicSlots passes DealEntityGraph into generateSlotsForScenario", () => {
    const src = readSource(
      "src/lib/intake/slots/ensureDeterministicSlots.ts",
    );
    assert.ok(
      src.includes("buildDealEntityGraph") &&
      src.includes("generateSlotsForScenario(effectiveScenario, undefined, graph"),
      "Guard T-02: slot generation must build entity graph and pass it to generateSlotsForScenario",
    );
  });

  test("Guard T-03: computeDealReadiness checks entityBindingRequired and fails closed", () => {
    const src = readSource("src/lib/deals/readiness.ts");
    assert.ok(
      src.includes("entityBindingRequired") &&
      src.includes("getEntityBindingStatus") &&
      src.includes("Entity binding incomplete"),
      "Guard T-03: readiness must gate on entityBindingRequired from getEntityBindingStatus",
    );

    // Fail-closed: catch block must also return ready: false
    assert.ok(
      src.includes("Entity binding status unavailable"),
      "Guard T-03: readiness must fail closed when entity binding status is unavailable",
    );
  });

  test("Guard T-04: getEntityBindingStatus uses ENTITY_SCOPED_DOC_TYPES and returns entityBindingRequired", () => {
    const src = readSource(
      "src/lib/intake/slots/getEntityBindingStatus.ts",
    );
    assert.ok(
      src.includes("ENTITY_SCOPED_DOC_TYPES") &&
      src.includes("entityBindingRequired") &&
      src.includes("unboundEntityScopedSlotCount"),
      "Guard T-04: canonical helper must use ENTITY_SCOPED_DOC_TYPES and return entityBindingRequired + unboundEntityScopedSlotCount",
    );

    // Must throw on errors (not silently return defaults)
    assert.ok(
      src.includes("throw new Error"),
      "Guard T-04: helper must throw on query errors so callers can decide fail-closed vs fail-open",
    );
  });
});
