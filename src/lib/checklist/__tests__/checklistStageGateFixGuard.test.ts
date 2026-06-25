/**
 * SPEC-CHECKLIST-STAGE-GATE-FIX-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const READINESS_SRC = readFileSync(
  resolve(__dirname, "../../deals/readiness.ts"), "utf-8",
);
const ENGINE_SRC = readFileSync(
  resolve(__dirname, "../engine.ts"), "utf-8",
);
const DOC_VALIDITY_SRC = readFileSync(
  resolve(__dirname, "../docValidity.ts"), "utf-8",
);

describe("SPEC-CHECKLIST-STAGE-GATE-FIX-1 guards", () => {
  test("computeDealReadiness checklist select includes required_years", () => {
    assert.ok(
      READINESS_SRC.includes("required_years"),
      "checklist select must include required_years for tolerance logic",
    );
  });

  test("computeDealReadiness checklist select includes satisfied_years", () => {
    assert.ok(
      READINESS_SRC.includes("satisfied_years"),
      "checklist select must include satisfied_years for tolerance logic",
    );
  });

  test("reconcileChecklistForDeal PFS_CURRENT falls back to canonical_type match", () => {
    assert.ok(
      ENGINE_SRC.includes('itemKey === "PFS_CURRENT"'),
      "Engine must have PFS_CURRENT canonical_type fallback",
    );
    assert.ok(
      DOC_VALIDITY_SRC.includes('ct === "PFS"'),
      "PFS fallback must match canonical_type PFS (in docValidity.ts)",
    );
  });

  test("checklist engine minMostRecentYear uses currentYear-2 after filing deadline", () => {
    assert.ok(
      ENGINE_SRC.includes("currentYear - 2;"),
      "After filing deadline, minMostRecentYear must be currentYear-2 (not currentYear-1)",
    );
  });
});

describe("SPEC-CHECKLIST-DOCUMENT-SATISFACTION-RECONCILIATION-1 guards", () => {
  test("matchedDocs select includes validity columns so the PFS canonical fallback can fire", () => {
    for (const col of ["canonical_type", "quality_status", "is_active", "finalized_at"]) {
      assert.ok(
        ENGINE_SRC.includes(col),
        `matchedDocs/doc reads must include ${col} for validity-aware satisfaction`,
      );
    }
  });

  test("checklist item read includes received_document_id for self-heal", () => {
    assert.ok(
      ENGINE_SRC.includes("received_document_id"),
      "checklist select must include received_document_id to self-heal missing-but-linked items",
    );
  });

  test("satisfaction validates via isDocValidForChecklistKey (no blind canonical match)", () => {
    assert.ok(
      ENGINE_SRC.includes("isDocValidForChecklistKey"),
      "engine must gate satisfaction on the shared validity predicate",
    );
  });

  test("reconciliation invalidates lifecycle cache + schedules readiness refresh on change", () => {
    assert.ok(
      ENGINE_SRC.includes("invalidateLifecycleCache"),
      "reconcile must drop the lifecycle cache when an item is newly satisfied",
    );
    assert.ok(
      ENGINE_SRC.includes("scheduleReadinessRefresh"),
      "reconcile must schedule a readiness recompute when an item is newly satisfied",
    );
    // Gate combines the heavy-loop count with the delegated helper's count
    // (SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1), still guarded on > 0.
    assert.ok(
      ENGINE_SRC.includes("checklistMarkedReceived ?? 0) + satItemsMarked) > 0"),
      "refresh wiring must be gated on a real change (heavy loop + delegated helper) to stay loop-safe",
    );
  });

  test("satisfied_at is stamped when an item is marked received", () => {
    assert.ok(
      ENGINE_SRC.includes("satisfied_at: nowIso"),
      "marking received must stamp satisfied_at (schema-tolerant)",
    );
  });
});
