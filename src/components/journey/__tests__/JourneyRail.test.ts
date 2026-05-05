import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { __JOURNEY_RAIL_CANONICAL_STAGES } from "../JourneyRail";
import type { LifecycleStage } from "../../../buddy/lifecycle/model";
import { ALLOWED_STAGE_TRANSITIONS } from "../../../buddy/lifecycle/model";

const RAIL_PATH = path.resolve(__dirname, "../JourneyRail.tsx");
const STAGE_ROW_PATH = path.resolve(__dirname, "../StageRow.tsx");
const railSrc = fs.readFileSync(RAIL_PATH, "utf-8");
const stageRowSrc = fs.readFileSync(STAGE_ROW_PATH, "utf-8");

const EXPECTED_LINEAR: LifecycleStage[] = [
  "intake_created",
  "docs_requested",
  "docs_in_progress",
  "docs_satisfied",
  "underwrite_ready",
  "underwrite_in_progress",
  "committee_ready",
  "committee_decisioned",
  "closing_in_progress",
  "closed",
];

describe("JourneyRail — canonical stage list", () => {
  it("renders all 11 canonical lifecycle stages including workout", () => {
    assert.equal(__JOURNEY_RAIL_CANONICAL_STAGES.length, 11);
    assert.deepEqual(
      __JOURNEY_RAIL_CANONICAL_STAGES.slice(0, 10),
      EXPECTED_LINEAR,
    );
    assert.equal(__JOURNEY_RAIL_CANONICAL_STAGES[10], "workout");
  });

  it("linear stage order matches model.ts ALLOWED_STAGE_TRANSITIONS", () => {
    // For each linear stage, the next stage in the rail must be a transition
    // listed in ALLOWED_STAGE_TRANSITIONS (excluding the workout branch).
    for (let i = 0; i < EXPECTED_LINEAR.length - 1; i++) {
      const cur = EXPECTED_LINEAR[i];
      const next = EXPECTED_LINEAR[i + 1];
      const allowed = ALLOWED_STAGE_TRANSITIONS[cur];
      assert.ok(
        allowed.includes(next),
        `Rail order ${cur}→${next} is not in ALLOWED_STAGE_TRANSITIONS[${cur}]`,
      );
    }
  });
});

describe("JourneyRail — structural guarantees", () => {
  it("imports getNextAction (single current-stage action)", () => {
    assert.ok(railSrc.includes('from "@/buddy/lifecycle/nextAction"'));
    assert.ok(railSrc.includes("getNextAction"));
  });

  it("uses STAGE_LABELS from lifecycle model (no hand-typed labels)", () => {
    // Labels are looked up via STAGE_LABELS in StageRow / RailHeader.
    const headerSrc = fs.readFileSync(
      path.resolve(__dirname, "../RailHeader.tsx"),
      "utf-8",
    );
    assert.ok(headerSrc.includes("STAGE_LABELS"));
    assert.ok(stageRowSrc.includes("STAGE_LABELS"));
  });

  it("uses blockerGatesStage to partition blockers", () => {
    assert.ok(railSrc.includes("blockerGatesStage"));
  });

  it("renders horizontal variant only on mobile (lg:hidden)", () => {
    assert.ok(railSrc.includes("lg:hidden"));
  });

  it("renders vertical variant only on desktop (hidden lg:flex)", () => {
    assert.ok(railSrc.includes("hidden lg:flex"));
  });

  it("desktop rail is approximately 260px wide", () => {
    assert.ok(railSrc.includes("w-[260px]"));
  });

  it("partitions infrastructure blockers into a rail-level banner", () => {
    assert.ok(railSrc.includes("infrastructure"));
    assert.ok(railSrc.includes("journey-rail-infra-blocker"));
  });

  it("only the current stage may render an action", () => {
    // The action prop is only forwarded to StageRow when status === 'current'.
    assert.ok(railSrc.includes('status === "current" ? action : null'));
  });

  it("logs dev-only warning for unknown stages (no crash)", () => {
    assert.ok(railSrc.includes("Unknown lifecycle stage"));
    assert.ok(railSrc.includes("NODE_ENV"));
  });
});

describe("JourneyRail — accessibility", () => {
  it("rail has aria-label='Deal journey'", () => {
    assert.ok(railSrc.includes('aria-label="Deal journey"'));
  });

  it("locked stages render aria-disabled='true' (StageRow)", () => {
    assert.ok(stageRowSrc.includes('aria-disabled="true"'));
  });

  it("current stage row has aria-current='step' when interactive", () => {
    assert.ok(stageRowSrc.includes('aria-current={status === "current" ? "step" : undefined}'));
  });
});

describe("JourneyRail — workout branch", () => {
  it("renders workout row separately, marked off-path when not active", () => {
    assert.ok(
      railSrc.includes('stage === "workout"'),
      "expected explicit workout branch handling",
    );
  });

  it("dimming the linear path when current stage IS workout (skipped status)", () => {
    assert.ok(railSrc.includes('currentStage === "workout"'));
  });
});
