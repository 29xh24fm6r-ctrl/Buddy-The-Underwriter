/**
 * Source-level guard tests for SPEC-EXTRACTION-STATUS-RESET-1.
 *
 * Ensures processDocExtractionOutbox resets intake_status to
 * CLASSIFIED_PENDING_REVIEW after successful extraction, with the
 * correct guard condition and non-fatal error handling.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = fs.readFileSync(
  "src/lib/workers/processDocExtractionOutbox.ts",
  "utf-8",
);

test("processDocExtractionOutbox updates intake_status to CLASSIFIED_PENDING_REVIEW on success", () => {
  assert.match(SRC, /intake_status.*CLASSIFIED_PENDING_REVIEW/);
  // Must appear after delivered_at update
  const deliveredIdx = SRC.indexOf("delivered_at:");
  const statusIdx = SRC.indexOf('"CLASSIFIED_PENDING_REVIEW"');
  assert.ok(
    deliveredIdx > 0 && statusIdx > deliveredIdx,
    "intake_status reset must follow delivered_at mark",
  );
});

test("intake_status update uses .eq guard on LOCKED_FOR_PROCESSING", () => {
  // The update must be conditional — only overwrite LOCKED_FOR_PROCESSING
  const updateBlock = SRC.slice(
    SRC.indexOf('"CLASSIFIED_PENDING_REVIEW"'),
    SRC.indexOf('"CLASSIFIED_PENDING_REVIEW"') + 200,
  );
  assert.match(updateBlock, /\.eq\(.*intake_status.*LOCKED_FOR_PROCESSING/);
});

test("statusErr is treated as non-fatal (console.warn, not throw)", () => {
  assert.match(SRC, /statusErr/);
  assert.match(SRC, /console\.warn.*failed to reset intake_status.*non-fatal/);
  // Must NOT throw on statusErr — verify no "throw" near statusErr
  const statusErrIdx = SRC.indexOf("if (statusErr)");
  assert.ok(statusErrIdx > 0);
  const block = SRC.slice(statusErrIdx, statusErrIdx + 300);
  assert.ok(!block.includes("throw"), "statusErr must not throw");
});
