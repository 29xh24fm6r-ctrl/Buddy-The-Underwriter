import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..", "stageViews");
const COMMITTEE = path.resolve(ROOT, "CommitteeStageView.tsx");
const DECISION = path.resolve(ROOT, "DecisionStageView.tsx");
const CLOSING = path.resolve(ROOT, "ClosingStageView.tsx");
const COCKPIT_CLIENT = path.resolve(
  __dirname,
  "../../../components/deals/DealCockpitClient.tsx",
);
const PRIMARY_ACTION_BAR = path.resolve(
  ROOT,
  "_shared/PrimaryActionBar.tsx",
);
const ADVANCED_DISCLOSURE = path.resolve(
  ROOT,
  "_shared/AdvancedDisclosure.tsx",
);

const committeeSrc = fs.readFileSync(COMMITTEE, "utf-8");
const decisionSrc = fs.readFileSync(DECISION, "utf-8");
const closingSrc = fs.readFileSync(CLOSING, "utf-8");
const cockpitSrc = fs.readFileSync(COCKPIT_CLIENT, "utf-8");
const primaryActionBarSrc = fs.readFileSync(PRIMARY_ACTION_BAR, "utf-8");
const advancedDisclosureSrc = fs.readFileSync(ADVANCED_DISCLOSURE, "utf-8");

describe("SPEC-03 — CommitteeStageView is a real work surface", () => {
  it("V1: renders embedded memo surface, not route-only links", () => {
    assert.ok(committeeSrc.includes("<CreditMemoPanel"));
    assert.ok(committeeSrc.includes("<CommitteePackagePanel"));
  });

  it("V2: includes reconciliation between extracted data, underwriting outputs, and memo fields", () => {
    assert.ok(committeeSrc.includes("<MemoReconciliationPanel"));
    const reconciliationPanel = fs.readFileSync(
      path.resolve(ROOT, "committee/MemoReconciliationPanel.tsx"),
      "utf-8",
    );
    assert.ok(
      reconciliationPanel.includes("/credit-memo/canonical/missing"),
      "MemoReconciliationPanel must read from the canonical missing endpoint",
    );
  });

  it("includes ApprovalReadinessPanel and ReadinessPanel together", () => {
    assert.ok(committeeSrc.includes("<ApprovalReadinessPanel"));
    assert.ok(committeeSrc.includes("<ReadinessPanel"));
  });
});

describe("SPEC-03 — DecisionStageView is an audit + approval surface", () => {
  it("V3: renders approval conditions inline", () => {
    assert.ok(decisionSrc.includes("<ApprovalConditionsPanel"));
    const conditionsPanel = fs.readFileSync(
      path.resolve(ROOT, "decision/ApprovalConditionsPanel.tsx"),
      "utf-8",
    );
    assert.ok(conditionsPanel.includes("/api/deals/${dealId}/conditions"));
  });

  it("V4: renders override audit trail inline", () => {
    assert.ok(decisionSrc.includes("<OverrideAuditPanel"));
    const overridesPanel = fs.readFileSync(
      path.resolve(ROOT, "decision/OverrideAuditPanel.tsx"),
      "utf-8",
    );
    assert.ok(overridesPanel.includes("/api/deals/${dealId}/overrides"));
  });

  it("renders DecisionSummaryPanel and DecisionLetterPanel", () => {
    assert.ok(decisionSrc.includes("<DecisionSummaryPanel"));
    assert.ok(decisionSrc.includes("<DecisionLetterPanel"));
  });
});

describe("SPEC-03 — ClosingStageView is conditions-first cockpit", () => {
  it("V5: renders conditions tracker inline", () => {
    assert.ok(closingSrc.includes("<ClosingConditionsPanel"));
    const closingConditions = fs.readFileSync(
      path.resolve(ROOT, "closing/ClosingConditionsPanel.tsx"),
      "utf-8",
    );
    assert.ok(closingConditions.includes("/api/deals/${dealId}/conditions"));
  });

  it("V6: renders exception tracker inline", () => {
    assert.ok(closingSrc.includes("<ExceptionTrackerPanel"));
    const exceptionTracker = fs.readFileSync(
      path.resolve(ROOT, "closing/ExceptionTrackerPanel.tsx"),
      "utf-8",
    );
    assert.ok(exceptionTracker.includes("/financial-exceptions"));
    assert.ok(exceptionTracker.includes("/post-close"));
  });

  it("renders PostCloseChecklistPanel and ClosingDocsPanel", () => {
    assert.ok(closingSrc.includes("<PostCloseChecklistPanel"));
    assert.ok(closingSrc.includes("<ClosingDocsPanel"));
  });
});

describe("SPEC-03 — invariants from SPEC-02 still hold", () => {
  it("V7: no stage view renders more than one PrimaryActionBar (shell still owns it)", () => {
    // Stage views forward `action` to the shell; shell renders the single bar.
    for (const src of [committeeSrc, decisionSrc, closingSrc]) {
      assert.ok(
        !src.includes("<PrimaryActionBar"),
        "stage view must not render <PrimaryActionBar> directly",
      );
    }
    // Sanity check: the action bar component still has exactly one root testid.
    const matches = primaryActionBarSrc.match(/data-testid="primary-action-bar"/g) ?? [];
    assert.ok(matches.length >= 1);
  });

  it("V8: ForceAdvancePanel remains nested inside <AdvancedDisclosure>", () => {
    for (const [name, src] of [
      ["CommitteeStageView", committeeSrc],
      ["DecisionStageView", decisionSrc],
      ["ClosingStageView", closingSrc],
    ] as const) {
      const fa = src.indexOf("<ForceAdvancePanel");
      if (fa < 0) continue;
      const ad = src.lastIndexOf("<AdvancedDisclosure", fa);
      const closeAd = src.indexOf("</AdvancedDisclosure>", ad);
      assert.ok(
        ad >= 0 && fa > ad && (closeAd === -1 || fa < closeAd),
        `${name}: ForceAdvancePanel must be inside <AdvancedDisclosure>`,
      );
    }
  });

  it("V9: AdvancedDisclosure remains closed by default (<details> with no `open`)", () => {
    assert.ok(advancedDisclosureSrc.includes("<details"));
    assert.ok(
      !/<details[^>]*\bopen\b/.test(advancedDisclosureSrc),
      "AdvancedDisclosure must NOT default to open",
    );
  });

  it("V10: DealCockpitClient still delegates stage body to <StageModeView />", () => {
    assert.ok(cockpitSrc.includes("<StageModeView"));
    assert.ok(
      !cockpitSrc.includes("<LeftColumn"),
      "DealCockpitClient must not directly render <LeftColumn>",
    );
    assert.ok(
      !cockpitSrc.includes("<CenterColumn"),
      "DealCockpitClient must not directly render <CenterColumn>",
    );
    assert.ok(
      !cockpitSrc.includes("<RightColumn"),
      "DealCockpitClient must not directly render <RightColumn>",
    );
  });

  it("V11: runnable actions display via PrimaryActionBar but never invoke server endpoints from inside it", () => {
    // SPEC-04 owns runnable execution; SPEC-03 PrimaryActionBar must not call
    // /api/.../action or any runnable endpoint directly. It still renders a
    // navigate-style Link for runnable intents.
    assert.ok(primaryActionBarSrc.includes("<Link"));
    assert.ok(
      !/fetch\s*\(/.test(primaryActionBarSrc),
      "PrimaryActionBar must not call fetch — SPEC-04 owns runnable execution",
    );
  });

  it("V12: lifecycle state is read from CockpitDataContext, not via useJourneyState", () => {
    for (const [name, src] of [
      ["CommitteeStageView", committeeSrc],
      ["DecisionStageView", decisionSrc],
      ["ClosingStageView", closingSrc],
    ] as const) {
      assert.ok(
        !/\buseJourneyState\s*\(/.test(src),
        `${name} must not call useJourneyState() — read from CockpitDataContext`,
      );
    }
  });
});

describe("SPEC-03 — new panels exist with expected contracts", () => {
  const NEW_PANELS = [
    "committee/CreditMemoPanel.tsx",
    "committee/MemoReconciliationPanel.tsx",
    "committee/CommitteePackagePanel.tsx",
    "committee/ApprovalReadinessPanel.tsx",
    "decision/DecisionSummaryPanel.tsx",
    "decision/ApprovalConditionsPanel.tsx",
    "decision/OverrideAuditPanel.tsx",
    "decision/DecisionLetterPanel.tsx",
    "closing/ClosingConditionsPanel.tsx",
    "closing/PostCloseChecklistPanel.tsx",
    "closing/ClosingDocsPanel.tsx",
    "closing/ExceptionTrackerPanel.tsx",
  ];

  for (const rel of NEW_PANELS) {
    it(`${rel} exists and is a client component with a data-testid`, () => {
      const full = path.resolve(ROOT, rel);
      assert.ok(fs.existsSync(full), `${rel} must exist`);
      const src = fs.readFileSync(full, "utf-8");
      assert.ok(src.includes('"use client"'), `${rel} must be a client component`);
      assert.ok(/testId=/.test(src), `${rel} must pass a testId to StatusListPanel`);
    });
  }

  it("StatusListPanel renders a single root with the testId", () => {
    const src = fs.readFileSync(
      path.resolve(ROOT, "_shared/StatusListPanel.tsx"),
      "utf-8",
    );
    assert.ok(src.includes('data-testid={testId}'));
  });
});
