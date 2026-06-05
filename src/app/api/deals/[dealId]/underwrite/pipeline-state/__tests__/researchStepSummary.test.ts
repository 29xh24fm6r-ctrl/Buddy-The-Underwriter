import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SPEC-BIE-COMMITTEE-ACTION-CENTER-AND-OFFICIAL-PDF-CAPTURE-1 — Phase 4
 * The Buddy Research pipeline summary must be SHORT — the long source/quality
 * story lives in Committee Readiness → Technical audit details, not the rail.
 */

const SRC = fs.readFileSync(path.resolve(__dirname, "..", "route.ts"), "utf8");

describe("pipeline research step — short summary (Phase 4)", () => {
  it("preliminary shows the short one-liner, not the appended degraded reasons", () => {
    assert.match(SRC, /Preliminary clear · Committee not ready/);
    // The long degraded reasons must NOT be appended to the preliminary detail.
    assert.doesNotMatch(SRC, /detail \+= ` — \$\{reasons\}`/);
  });

  it("committee-grade shows a short ready summary", () => {
    assert.match(SRC, /Committee-grade ✓ · Committee ready/);
  });
});
