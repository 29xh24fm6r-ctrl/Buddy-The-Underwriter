import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "stageViews");
const STAGE_VIEW_FILES = [
  "IntakeStageView.tsx",
  "DocumentsStageView.tsx",
  "UnderwritingStageView.tsx",
  "CommitteeStageView.tsx",
  "DecisionStageView.tsx",
  "ClosingStageView.tsx",
  "WorkoutStageView.tsx",
];

const SHARED = path.resolve(ROOT, "_shared");
const SHELL = fs.readFileSync(path.resolve(SHARED, "StageWorkspaceShell.tsx"), "utf-8");
const ACTION_BAR = fs.readFileSync(path.resolve(SHARED, "PrimaryActionBar.tsx"), "utf-8");
const BLOCKER_LIST = fs.readFileSync(path.resolve(SHARED, "StageBlockerList.tsx"), "utf-8");
const ADVANCED = fs.readFileSync(path.resolve(SHARED, "AdvancedDisclosure.tsx"), "utf-8");

function readView(file: string): string {
  return fs.readFileSync(path.resolve(ROOT, file), "utf-8");
}

describe("Stage views — wrap content in StageWorkspaceShell", () => {
  for (const file of STAGE_VIEW_FILES) {
    it(`${file} renders <StageWorkspaceShell> as the outer layout`, () => {
      const src = readView(file);
      assert.ok(
        src.includes("<StageWorkspaceShell"),
        `${file} must wrap content in <StageWorkspaceShell>`,
      );
    });

    it(`${file} forwards a single \`action\` prop (one primary action)`, () => {
      const src = readView(file);
      // Each stage view destructures `action` and forwards it to the shell.
      assert.ok(
        src.includes("action={action}"),
        `${file} must forward action={action} to StageWorkspaceShell`,
      );
    });

    it(`${file} forwards \`blockers\` to the shell (used by StageBlockerList)`, () => {
      const src = readView(file);
      assert.ok(
        src.includes("blockers={blockers}"),
        `${file} must forward blockers prop to StageWorkspaceShell`,
      );
    });
  }
});

describe("Stage views — exactly one PrimaryActionBar per render path", () => {
  it("StageWorkspaceShell renders exactly one <PrimaryActionBar />", () => {
    const matches = SHELL.match(/<PrimaryActionBar\b/g) ?? [];
    assert.equal(matches.length, 1, "shell must render <PrimaryActionBar> exactly once");
  });

  it("no stage view renders its own <PrimaryActionBar /> (single source of truth)", () => {
    for (const file of STAGE_VIEW_FILES) {
      const src = readView(file);
      assert.ok(
        !src.includes("<PrimaryActionBar"),
        `${file} must not render <PrimaryActionBar> directly — shell does it`,
      );
    }
  });
});

describe("Stage views — blocker fix paths", () => {
  it("StageBlockerList renders blocker fix actions via getBlockerFixAction", () => {
    assert.ok(BLOCKER_LIST.includes("getBlockerFixAction"));
    assert.ok(BLOCKER_LIST.includes('data-testid="blocker-fix-action"'));
  });

  it("StageBlockerList hides itself when there are no blockers", () => {
    assert.ok(
      BLOCKER_LIST.includes("blockers.length === 0") ||
        BLOCKER_LIST.includes("!blockers || blockers.length"),
      "blocker list must early-return when there are no blockers",
    );
  });

  it("StageWorkspaceShell renders <StageBlockerList /> exactly once", () => {
    const matches = SHELL.match(/<StageBlockerList\b/g) ?? [];
    assert.equal(matches.length, 1);
  });
});

describe("Stage views — advanced/admin tools hidden by default", () => {
  it("AdvancedDisclosure uses native <details> with no `open` attribute", () => {
    assert.ok(ADVANCED.includes("<details"));
    assert.ok(
      !/<details[^>]*\bopen\b/.test(ADVANCED),
      "advanced disclosure must NOT default to open",
    );
  });

  it("every stage view either omits advanced= or wraps it in <AdvancedDisclosure>", () => {
    for (const file of STAGE_VIEW_FILES) {
      const src = readView(file);
      const hasAdvancedProp = /\badvanced\s*=/.test(src);
      if (hasAdvancedProp) {
        assert.ok(
          src.includes("<AdvancedDisclosure"),
          `${file} forwards an advanced= prop but does not use <AdvancedDisclosure> — admin tools could leak`,
        );
      }
    }
  });

  it("ForceAdvancePanel is only rendered behind <AdvancedDisclosure>", () => {
    for (const file of STAGE_VIEW_FILES) {
      const src = readView(file);
      if (!src.includes("ForceAdvancePanel")) continue;

      // Pattern A — same function body.
      const fa = src.indexOf("<ForceAdvancePanel");
      const ad = src.lastIndexOf("<AdvancedDisclosure", fa);
      const closeAd = src.indexOf("</AdvancedDisclosure>", ad);
      const directlyNested =
        ad >= 0 && fa > ad && (closeAd === -1 || fa < closeAd);
      if (directlyNested) continue;

      // Pattern B (SPEC-05) — extracted *AdvancedBody component referenced
      // inside <AdvancedDisclosure>.
      const bodyMatch = src.match(/(\w+AdvancedBody)\b/);
      assert.ok(
        bodyMatch && src.includes("<AdvancedDisclosure"),
        `${file}: ForceAdvancePanel must live inside <AdvancedDisclosure> (or an extracted *AdvancedBody)`,
      );
    }
  });
});

describe("PrimaryActionBar — renders single action and respects intent", () => {
  it("renders a button + executes through useCockpitAction (SPEC-04)", () => {
    // SPEC-04 replaced the <Link> with a <button> that runs through the
    // unified useCockpitAction pipeline so navigation, runnable, and
    // fix_blocker share telemetry + refresh semantics.
    assert.ok(ACTION_BAR.includes("useCockpitAction"));
    assert.match(ACTION_BAR, /<button[\s\S]*data-testid="primary-action-cta"/);
  });

  it("complete intent renders status chip (no executable button)", () => {
    assert.ok(ACTION_BAR.includes('intent === "complete"'));
  });

  it("blocked intent renders amber chip (no executable button)", () => {
    assert.ok(ACTION_BAR.includes('intent === "blocked"'));
  });

  it("emits a single root with data-testid='primary-action-bar'", () => {
    const matches = ACTION_BAR.match(/data-testid="primary-action-bar"/g) ?? [];
    assert.ok(matches.length >= 1, "primary-action-bar testid must exist");
  });
});

describe("Stage views — DealHealthPanel + BankerVoicePanel placement invariant", () => {
  it("UnderwritingStageView keeps StoryPanel mounted (which carries DealHealthPanel + BankerVoicePanel)", () => {
    const src = readView("UnderwritingStageView.tsx");
    assert.ok(
      src.includes("<StoryPanel"),
      "UnderwritingStageView must mount StoryPanel — that's the canonical home for DealHealthPanel + BankerVoicePanel",
    );
  });

  it("StoryPanel still wraps DealHealthPanel + BankerVoicePanel (existing invariant)", () => {
    const storyPanelSrc = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../components/deals/cockpit/panels/StoryPanel.tsx",
      ),
      "utf-8",
    );
    assert.ok(storyPanelSrc.includes("<DealHealthPanel"));
    assert.ok(storyPanelSrc.includes("<BankerVoicePanel"));
  });
});

describe("Stage views — no stage view duplicates the lifecycle fetch", () => {
  it("no stage view calls useJourneyState — they receive state via props", () => {
    for (const file of STAGE_VIEW_FILES) {
      const src = readView(file);
      assert.ok(
        !src.includes("useJourneyState"),
        `${file} must not call useJourneyState — state arrives via props`,
      );
    }
  });

  it("StageWorkspaceShell does not call useJourneyState", () => {
    assert.ok(!SHELL.includes("useJourneyState"));
  });
});
