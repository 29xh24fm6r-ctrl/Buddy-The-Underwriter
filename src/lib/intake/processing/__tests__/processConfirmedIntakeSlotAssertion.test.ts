/**
 * SPEC-INTAKE-V2 PR1 — Zero-Slot Structural Assertion CI Guards
 *
 * PIV-4 confirmed 45% of recent deals reached PROCESSING_COMPLETE with zero
 * deterministic slots. PR1 adds a structural assertion in processConfirmedIntake
 * that emits intake.processing_no_slots with requiresHumanReview=true so ops
 * can investigate before the gap is promoted to a hard invariant.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

describe("processConfirmedIntake zero-slot structural assertion", () => {
  const src = readFile("src/lib/intake/processing/processConfirmedIntake.ts");

  test("Guard 1: assertion queries deal_document_slots for a count", () => {
    assert.ok(
      src.includes('from("deal_document_slots")'),
      "processConfirmedIntake must query deal_document_slots",
    );
    assert.ok(
      src.includes('count: "exact"') && src.includes("head: true"),
      "Slot count must use a head:true count:exact select",
    );
  });

  test("Guard 2: zero-slot branch emits intake.processing_no_slots", () => {
    assert.ok(
      src.includes('kind: "intake.processing_no_slots"'),
      "Zero-slot branch must emit intake.processing_no_slots event",
    );
  });

  test("Guard 3: zero-slot event carries requiresHumanReview: true", () => {
    // Pull the writeEvent block whose kind is intake.processing_no_slots and
    // ensure requiresHumanReview is set to true. This is what surfaces the
    // event in the ops queue.
    const noSlotsEventBlock = src.match(
      /writeEvent\(\{[\s\S]*?intake\.processing_no_slots[\s\S]*?\}\);/,
    );
    assert.ok(noSlotsEventBlock, "Zero-slot event block must be present");
    assert.ok(
      noSlotsEventBlock![0].includes("requiresHumanReview: true"),
      "Zero-slot event must set requiresHumanReview: true",
    );
  });

  test("Guard 4: zero-slot path adds a structural error to the errors array", () => {
    assert.ok(
      src.includes(
        '"structural: deal completed processing with zero slots"',
      ) || src.includes("errors.push(\"structural"),
      "Zero-slot branch must push a structural error onto errors[]",
    );
  });

  test("Guard 5: assertion runs after recomputeDealDocumentState and before bootstrapDealLifecycle", () => {
    const recomputeIdx = src.indexOf("recomputeDealDocumentState(dealId)");
    const slotAssertionIdx = src.indexOf("intake.processing_no_slots");
    const bootstrapIdx = src.indexOf("bootstrapDealLifecycle(dealId)");

    assert.ok(recomputeIdx >= 0, "recomputeDealDocumentState call must exist");
    assert.ok(slotAssertionIdx >= 0, "Zero-slot assertion must exist");
    assert.ok(bootstrapIdx >= 0, "bootstrapDealLifecycle call must exist");

    assert.ok(
      recomputeIdx < slotAssertionIdx,
      "Slot assertion must run AFTER recomputeDealDocumentState (snapshot is the cockpit truth)",
    );
    assert.ok(
      slotAssertionIdx < bootstrapIdx,
      "Slot assertion must run BEFORE bootstrapDealLifecycle (lifecycle reads slots)",
    );
  });
});
