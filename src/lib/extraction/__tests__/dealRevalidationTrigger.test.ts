/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 2b tests.
 *
 * Pure unit:
 *   - shouldTriggerDealRevalidation: 0 → true; 1,2 → false; negative/NaN → false.
 *
 * Source-grep guards (runRecord.ts is server-only with no fake-Supabase seam, so
 * wiring is asserted by inspection — matching the extraction directory's
 * convention):
 *   - finalizeExtractionRun queries deal_extraction_runs for queued/running,
 *     calls shouldTriggerDealRevalidation, dynamically imports + calls
 *     revalidateDealDocuments, fire-and-forget so it cannot throw out of finalize.
 *   - the existing per-doc runPostExtractionValidation trigger is STILL present
 *     (regression guard against accidental removal).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { shouldTriggerDealRevalidation } from "@/lib/extraction/revalidationSummary";

function read(relPath: string): string {
  return readFileSync(path.resolve(__dirname, "../../../..", relPath), "utf-8");
}

// ── Pure: shouldTriggerDealRevalidation ────────────────────────────────────

test("[vgr2b-pred-a] 0 in-flight → true (deal quiescent, fire)", () => {
  assert.equal(shouldTriggerDealRevalidation(0), true);
});

test("[vgr2b-pred-b] 1 or 2 in-flight → false (still extracting)", () => {
  assert.equal(shouldTriggerDealRevalidation(1), false);
  assert.equal(shouldTriggerDealRevalidation(2), false);
});

test("[vgr2b-pred-c] negative and NaN → false (defensive)", () => {
  assert.equal(shouldTriggerDealRevalidation(-1), false);
  assert.equal(shouldTriggerDealRevalidation(Number.NaN), false);
});

// ── Grep guard: finalizeExtractionRun deal-completion trigger ───────────────

const RUN_RECORD = read("src/lib/extraction/runRecord.ts");

test("[vgr2b-wire-a] counts in-flight runs via deal_extraction_runs queued/running", () => {
  assert.match(
    RUN_RECORD,
    /\.from\(["']deal_extraction_runs["']\)[\s\S]{0,200}\.in\(["']status["'],\s*\[["']queued["'],\s*["']running["']\]\)/,
    "must count queued/running runs on deal_extraction_runs",
  );
  assert.match(
    RUN_RECORD,
    /\.eq\(["']deal_id["'],\s*args\.dealId\)/,
    "in-flight count must be scoped to the deal",
  );
  assert.match(
    RUN_RECORD,
    /count:\s*["']exact["'],\s*head:\s*true/,
    "must use a head/exact count (no row payload)",
  );
});

test("[vgr2b-wire-b] gates on shouldTriggerDealRevalidation and calls revalidateDealDocuments", () => {
  assert.match(
    RUN_RECORD,
    /shouldTriggerDealRevalidation\(count\s*\?\?\s*0\)/,
    "must gate the trigger on shouldTriggerDealRevalidation(count ?? 0)",
  );
  assert.match(
    RUN_RECORD,
    /await import\(["']\.\/revalidateDealDocuments["']\)/,
    "must dynamically import revalidateDealDocuments (avoid import cycle)",
  );
  assert.match(
    RUN_RECORD,
    /await revalidateDealDocuments\(args\.dealId\)/,
    "must call revalidateDealDocuments(args.dealId)",
  );
});

test("[vgr2b-wire-c] deal-completion block is fire-and-forget and cannot throw out of finalize", () => {
  // Isolate the Phase 2b block by its marker comment through to its IIFE close.
  const block = RUN_RECORD.match(
    /Phase 2b[\s\S]*?void \(async \(\) => \{[\s\S]*?must never break extraction[\s\S]*?\}\)\(\);/,
  );
  assert.ok(block, "Phase 2b fire-and-forget block must exist");
  assert.match(block![0], /void \(async/, "must use the void (async () => ...)() pattern");
  assert.match(block![0], /try \{[\s\S]*?\} catch/, "must wrap the work in try/catch");
});

test("[vgr2b-wire-d] runs on EVERY finalize — NOT nested under the succeeded-only block", () => {
  // The succeeded-only per-doc block ends with its IIFE + closing brace. The
  // Phase 2b block must appear AFTER that closing brace (deal-level, any status),
  // not inside the `if (args.status === "succeeded")` body.
  const succeededClose = RUN_RECORD.indexOf("/* validation must never break extraction */ }");
  const phase2bIdx = RUN_RECORD.indexOf("Phase 2b");
  assert.ok(succeededClose > 0, "per-doc succeeded block must exist");
  assert.ok(phase2bIdx > succeededClose, "Phase 2b block must come after the succeeded-only block");
  // And the block itself is not guarded by a status === succeeded check.
  const block = RUN_RECORD.slice(phase2bIdx, phase2bIdx + 900);
  assert.equal(
    /args\.status === ["']succeeded["']/.test(block),
    false,
    "Phase 2b block must NOT be gated on succeeded — every terminal status revalidates",
  );
});

// ── Regression guard: per-doc trigger must remain ──────────────────────────

test("[vgr2b-regress-a] existing per-doc runPostExtractionValidation trigger is still present", () => {
  assert.match(
    RUN_RECORD,
    /if \(args\.status === ["']succeeded["']\)/,
    "per-doc validation must still be gated on succeeded",
  );
  assert.match(
    RUN_RECORD,
    /runPostExtractionValidation\(/,
    "per-doc runPostExtractionValidation trigger must NOT be removed",
  );
});
