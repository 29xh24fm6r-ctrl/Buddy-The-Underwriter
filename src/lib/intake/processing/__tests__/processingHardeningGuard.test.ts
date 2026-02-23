/**
 * CI Guard — Processing Hardening Invariants
 *
 * Guards for the post-observability hardening layer:
 * - CAS helper uses run_id WHERE clause
 * - transitionPhaseAndEmit uses CAS helper (not bare .eq("id"))
 * - PII scrubbing correctness
 * - Error summarizer bounds
 * - Stuck reason UX completeness
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  scrubPii,
  summarizeProcessingErrors,
  MAX_ERRORS,
  MAX_ERROR_LEN,
} from "@/lib/intake/processing/summarizeProcessingError";

import { getStuckReasonUx } from "@/lib/intake/processing/stuckReasonUx";

import type { StuckReason } from "@/lib/intake/processing/detectStuckProcessing";

// ── Source file readers ──────────────────────────────────────────────────

function readSrc(relPath: string): string {
  // __dirname = src/lib/intake/processing/__tests__
  // Project root = 5 levels up
  return readFileSync(resolve(__dirname, "../../../../..", relPath), "utf-8");
}

describe("Processing Hardening CI Guards", () => {
  // ── Guard 1: CAS helper uses run_id WHERE clause ─────────────────────
  test("[guard-1] updateDealIfRunOwner applies .eq('intake_processing_run_id', runId)", () => {
    const src = readSrc("src/lib/intake/processing/updateDealIfRunOwner.ts");
    assert.ok(
      src.includes('.eq("intake_processing_run_id", runId)'),
      "CAS helper must filter by intake_processing_run_id",
    );
  });

  // ── Guard 2: transitionPhaseAndEmit uses CAS helper ──────────────────
  test("[guard-2] transitionPhaseAndEmit calls updateDealIfRunOwner (not bare .eq('id'))", () => {
    const src = readSrc("src/lib/intake/processing/processConfirmedIntake.ts");

    // Extract the transitionPhaseAndEmit function body
    const fnStart = src.indexOf("async function transitionPhaseAndEmit");
    assert.ok(fnStart > -1, "transitionPhaseAndEmit must exist");

    const fnBody = src.slice(fnStart, fnStart + 1500);
    assert.ok(
      fnBody.includes("updateDealIfRunOwner"),
      "transitionPhaseAndEmit must call updateDealIfRunOwner",
    );
    // Verify the old bare update pattern is gone
    const barePattern = /\.from\("deals"\)\s*\n?\s*\.update\(updatePayload\)\s*\n?\s*\.eq\("id"/;
    assert.ok(
      !barePattern.test(fnBody),
      "transitionPhaseAndEmit must NOT use bare .eq('id', dealId) update",
    );
  });

  // ── Guard 3: scrubPii redacts SSN pattern ────────────────────────────
  test("[guard-3] scrubPii redacts SSN pattern 123-45-6789", () => {
    const input = "Error for SSN 123-45-6789 in document";
    const output = scrubPii(input);
    assert.ok(!output.includes("123-45-6789"), "SSN must be redacted");
    assert.ok(output.includes("[REDACTED]"), "Must replace with [REDACTED]");
  });

  // ── Guard 4: scrubPii redacts email pattern ──────────────────────────
  test("[guard-4] scrubPii redacts email pattern user@example.com", () => {
    const input = "Contact user@example.com for help";
    const output = scrubPii(input);
    assert.ok(!output.includes("user@example.com"), "Email must be redacted");
    assert.ok(output.includes("[REDACTED]"), "Must replace with [REDACTED]");
  });

  // ── Guard 5: summarizeProcessingErrors respects bounds ───────────────
  test("[guard-5] summarizeProcessingErrors respects MAX_ERRORS and MAX_ERROR_LEN", () => {
    assert.equal(MAX_ERRORS, 5, "MAX_ERRORS must be 5");
    assert.equal(MAX_ERROR_LEN, 300, "MAX_ERROR_LEN must be 300");

    // Generate 10 errors, each 400 chars
    const longError = "x".repeat(400);
    const errors = Array.from({ length: 10 }, () => longError);
    const result = summarizeProcessingErrors(errors);

    // Only 5 errors should be included, each truncated to 300
    assert.ok(result.length <= 500, `Result must be ≤ 500 chars, got ${result.length}`);
  });

  // ── Guard 6: getStuckReasonUx returns distinct headline per reason ───
  test("[guard-6] getStuckReasonUx returns distinct headline for each StuckReason", () => {
    const reasons: StuckReason[] = [
      "queued_never_started",
      "heartbeat_stale",
      "overall_timeout",
      "legacy_no_markers",
    ];

    const headlines = reasons.map((r) => getStuckReasonUx(r).headline);
    const unique = new Set(headlines);
    assert.equal(
      unique.size,
      reasons.length,
      `Headlines must be unique: ${JSON.stringify(headlines)}`,
    );

    // All must have non-empty headline, detail, cta
    for (const reason of reasons) {
      const ux = getStuckReasonUx(reason);
      assert.ok(ux.headline.length > 0, `${reason} must have headline`);
      assert.ok(ux.detail.length > 0, `${reason} must have detail`);
      assert.ok(ux.cta.length > 0, `${reason} must have cta`);
    }
  });
});
