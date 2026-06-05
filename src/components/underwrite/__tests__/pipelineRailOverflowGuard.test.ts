import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SPEC-BIE-COMMITTEE-READINESS-FINAL-UX-POLISH-AND-PDF-ARTIFACTS-1 — Phase 3.
 * Source guard: the Underwriting pipeline row must constrain its long research
 * summary so it truncates inside the card instead of forcing page-level
 * horizontal overflow.
 */

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "UnderwritingPipelineRail.tsx"),
  "utf8",
);

describe("UnderwritingPipelineRail — long-summary overflow guard", () => {
  it("the step detail truncates with a flex min-width-0 + title tooltip", () => {
    // The detail span must be able to shrink (min-w-0) and truncate.
    assert.match(SRC, /min-w-0 flex-1 truncate/);
    assert.match(SRC, /title=\{step\.detail\}/);
  });

  it("the step content column can shrink (min-w-0) so it never forces overflow", () => {
    assert.match(SRC, /flex-1 min-w-0 pb-3/);
  });

  it("the step label does not shrink/wrap away the truncation budget", () => {
    assert.match(SRC, /text-sm font-medium shrink-0/);
  });
});
