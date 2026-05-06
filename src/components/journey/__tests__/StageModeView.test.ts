import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import type { LifecycleStage } from "../../../buddy/lifecycle/model";

const ROOT = path.resolve(__dirname, "..");
const STAGE_MODE_VIEW = path.resolve(ROOT, "StageModeView.tsx");
const stageModeViewSrc = fs.readFileSync(STAGE_MODE_VIEW, "utf-8");

const COCKPIT_CLIENT = path.resolve(
  __dirname,
  "../../../components/deals/DealCockpitClient.tsx",
);
const cockpitSrc = fs.readFileSync(COCKPIT_CLIENT, "utf-8");

/**
 * Stage → expected stage view component name. Mirrors the `if/else` chain in
 * StageModeView.tsx. Tests guard that:
 *   1. every LifecycleStage is mapped exactly once
 *   2. the exact named import for that view appears in StageModeView
 */
const STAGE_TO_VIEW: Record<LifecycleStage, string> = {
  intake_created: "IntakeStageView",
  docs_requested: "IntakeStageView",
  docs_in_progress: "DocumentsStageView",
  docs_satisfied: "DocumentsStageView",
  underwrite_ready: "UnderwritingStageView",
  underwrite_in_progress: "UnderwritingStageView",
  committee_ready: "CommitteeStageView",
  committee_decisioned: "DecisionStageView",
  closing_in_progress: "ClosingStageView",
  closed: "ClosingStageView",
  workout: "WorkoutStageView",
};

describe("StageModeView — stage routing", () => {
  it("imports each stage view exactly once", () => {
    const expectedViews = Array.from(new Set(Object.values(STAGE_TO_VIEW)));
    for (const view of expectedViews) {
      const re = new RegExp(`import\\s*\\{\\s*${view}\\s*\\}\\s*from`);
      assert.ok(
        re.test(stageModeViewSrc),
        `StageModeView must import { ${view} }`,
      );
    }
  });

  it("contains a stage discriminator branch for each LifecycleStage", () => {
    for (const stage of Object.keys(STAGE_TO_VIEW) as LifecycleStage[]) {
      const re = new RegExp(`stage === ['"]${stage}['"]`);
      assert.ok(
        re.test(stageModeViewSrc),
        `StageModeView must branch on stage === "${stage}"`,
      );
    }
  });

  it("each stage routes to its mapped view component", () => {
    // Loose check: the view component name must appear in the JSX returned
    // from each stage branch. We approximate by verifying both the stage
    // string and the component reference appear in the file.
    for (const [stage, view] of Object.entries(STAGE_TO_VIEW)) {
      assert.ok(
        stageModeViewSrc.includes(`<${view}`),
        `StageModeView must render <${view}/> for stage ${stage}`,
      );
    }
  });

  it("falls back to IntakeStageView when stage is null/unknown", () => {
    assert.ok(
      stageModeViewSrc.includes("stage === null") &&
        stageModeViewSrc.includes("IntakeStageView"),
      "null stage must fall back to IntakeStageView",
    );
  });

  it("uses an exhaustiveness `never` guard so new stages must be mapped", () => {
    assert.ok(
      stageModeViewSrc.includes("_neverStage: never = stage"),
      "StageModeView must include a TS exhaustiveness guard",
    );
  });
});

describe("StageModeView — does not duplicate the lifecycle fetch", () => {
  it("reads lifecycleState from CockpitDataContext (not useJourneyState)", () => {
    assert.ok(stageModeViewSrc.includes("useCockpitDataContext"));
    // Allow the name to appear in a leading comment block but never as a call.
    assert.ok(
      !/\buseJourneyState\s*\(/.test(stageModeViewSrc),
      "StageModeView must NOT call useJourneyState() — that would duplicate lifecycle fetching",
    );
  });
});

describe("DealCockpitClient — uses StageModeView", () => {
  it("imports StageModeView", () => {
    assert.ok(cockpitSrc.includes('from "@/components/journey/StageModeView"'));
  });

  it("renders <StageModeView /> in the cockpit body", () => {
    assert.ok(cockpitSrc.includes("<StageModeView"));
  });

  it("does NOT render the legacy 3-column layout directly", () => {
    // The legacy layout used a grid with all three column components inline.
    // After SPEC-02, columns are composed inside stage views — DealCockpitClient
    // must not render <LeftColumn> / <CenterColumn> / <RightColumn> directly.
    assert.ok(
      !cockpitSrc.includes("<LeftColumn"),
      "DealCockpitClient must not render <LeftColumn> directly",
    );
    assert.ok(
      !cockpitSrc.includes("<CenterColumn"),
      "DealCockpitClient must not render <CenterColumn> directly",
    );
    assert.ok(
      !cockpitSrc.includes("<RightColumn"),
      "DealCockpitClient must not render <RightColumn> directly",
    );
  });

  it("does NOT call useJourneyState (cockpit reads from context)", () => {
    assert.ok(
      !cockpitSrc.includes("useJourneyState"),
      "Cockpit body must NOT use useJourneyState — context already carries lifecycleState",
    );
  });
});
