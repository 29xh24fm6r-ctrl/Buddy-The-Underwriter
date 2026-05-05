import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { legacyStageToCanonical } from "../JourneyMiniRail";

const SRC_PATH = path.resolve(__dirname, "../JourneyMiniRail.tsx");
const src = fs.readFileSync(SRC_PATH, "utf-8");

describe("JourneyMiniRail — legacy stage mapping", () => {
  it("'collecting' → docs_in_progress", () => {
    assert.equal(legacyStageToCanonical("collecting"), "docs_in_progress");
  });

  it("'underwriting' → underwrite_in_progress", () => {
    assert.equal(legacyStageToCanonical("underwriting"), "underwrite_in_progress");
  });

  it("'intake' → intake_created", () => {
    assert.equal(legacyStageToCanonical("intake"), "intake_created");
  });

  it("'created' → intake_created", () => {
    assert.equal(legacyStageToCanonical("created"), "intake_created");
  });

  it("'closing' → closing_in_progress", () => {
    assert.equal(legacyStageToCanonical("closing"), "closing_in_progress");
  });

  it("'funded' → closed", () => {
    assert.equal(legacyStageToCanonical("funded"), "closed");
  });

  it("canonical stage passes through ('docs_satisfied')", () => {
    assert.equal(legacyStageToCanonical("docs_satisfied"), "docs_satisfied");
  });

  it("uppercase passes through ('Underwriting' → underwrite_in_progress)", () => {
    assert.equal(legacyStageToCanonical("Underwriting"), "underwrite_in_progress");
  });

  it("null returns null", () => {
    assert.equal(legacyStageToCanonical(null), null);
  });

  it("unknown string returns null (renders muted unknown state)", () => {
    assert.equal(legacyStageToCanonical("totally_unknown_phase"), null);
  });
});

describe("JourneyMiniRail — structural guarantees", () => {
  it("renders 10 dots for the linear path (matches LINEAR_STAGES)", () => {
    // Linear stage list excludes workout and is the dot count.
    // Match the assignment `= [ ... ]` after LINEAR_STAGES (avoids the
    // unrelated `[]` in `LifecycleStage[]`).
    const linearMatch = src.match(/const LINEAR_STAGES[^=]*=\s*\[([\s\S]*?)\];/);
    assert.ok(linearMatch, "expected LINEAR_STAGES array literal");
    const entries = linearMatch![1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.equal(entries.length, 10, "linear path should be 10 stages");
  });

  it("does not call fetch (pure presentation)", () => {
    assert.ok(!src.includes("fetch("), "JourneyMiniRail must not perform fetches");
  });

  it("does not import useJourneyState or any hook that fetches", () => {
    assert.ok(!src.includes("useJourneyState"));
    assert.ok(!src.includes("useEffect"));
    assert.ok(!src.includes("useState"));
  });

  it("workout renders in muted/off-path style", () => {
    assert.ok(src.includes('canonical === "workout"'));
    assert.ok(src.includes("Workout"));
  });

  it("null/unknown stage shows tooltip 'Stage not yet derived.'", () => {
    assert.ok(src.includes("Stage not yet derived."));
  });

  it("has accessible aria-label per state", () => {
    assert.ok(src.includes("aria-label="));
  });

  it("does not use localStorage / sessionStorage / cookies", () => {
    assert.ok(!src.includes("localStorage"));
    assert.ok(!src.includes("sessionStorage"));
    assert.ok(!src.includes("document.cookie"));
  });
});
