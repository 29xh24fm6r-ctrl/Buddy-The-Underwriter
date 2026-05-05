import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { runCockpitAction, endpointFor, isKnownActionType } from "../actions/runCockpitAction";
import type {
  CockpitRunnableAction,
  ServerActionType,
} from "../actions/actionTypes";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const ACTIONS = path.resolve(__dirname, "..", "actions");

function readFile(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const STAGE_DATA_PROVIDER = readFile(SHARED, "StageDataProvider.tsx");
const USE_STAGE_JSON_RESOURCE = readFile(SHARED, "useStageJsonResource.ts");
const ACTION_FEEDBACK = readFile(SHARED, "ActionFeedback.tsx");
const PRIMARY_ACTION_BAR = readFile(SHARED, "PrimaryActionBar.tsx");
const STAGE_BLOCKER_LIST = readFile(SHARED, "StageBlockerList.tsx");
const USE_COCKPIT_ACTION = readFile(ACTIONS, "useCockpitAction.ts");
const LOG_COCKPIT_ACTION = readFile(ACTIONS, "logCockpitAction.ts");

const COMMITTEE_VIEW = readFile(STAGE_VIEWS, "CommitteeStageView.tsx");
const DECISION_VIEW = readFile(STAGE_VIEWS, "DecisionStageView.tsx");
const CLOSING_VIEW = readFile(STAGE_VIEWS, "ClosingStageView.tsx");
const DOCUMENTS_VIEW = readFile(STAGE_VIEWS, "DocumentsStageView.tsx");
const UNDERWRITING_VIEW = readFile(STAGE_VIEWS, "UnderwritingStageView.tsx");
const WORKOUT_VIEW = readFile(STAGE_VIEWS, "WorkoutStageView.tsx");
const COMMITTEE_PACKAGE_PANEL = readFile(STAGE_VIEWS, "committee/CommitteePackagePanel.tsx");

const ALL_STAGE_VIEWS: Record<string, string> = {
  CommitteeStageView: COMMITTEE_VIEW,
  DecisionStageView: DECISION_VIEW,
  ClosingStageView: CLOSING_VIEW,
  DocumentsStageView: DOCUMENTS_VIEW,
  UnderwritingStageView: UNDERWRITING_VIEW,
  WorkoutStageView: WORKOUT_VIEW,
};

describe("SPEC-05 V1 — every major stage registers a refresher", () => {
  for (const [name, src] of Object.entries(ALL_STAGE_VIEWS)) {
    it(`${name} calls useRegisterStageRefresher or useStageJsonResource`, () => {
      const usesDirect = src.includes("useRegisterStageRefresher");
      const usesResource = src.includes("useStageJsonResource");
      assert.ok(
        usesDirect || usesResource,
        `${name} must register at least one stage refresher`,
      );
    });
  }
});

describe("SPEC-05 V2/V3 — successful action invokes registered refreshers + router.refresh", () => {
  it("StageDataProvider invokes every registered refresher", () => {
    assert.match(
      STAGE_DATA_PROVIDER,
      /Promise\.all\([\s\S]*fns\.map/,
      "refreshStageData must await all registered refreshers in parallel",
    );
  });

  it("StageDataProvider calls router.refresh after refreshers settle", () => {
    assert.ok(STAGE_DATA_PROVIDER.includes("router.refresh()"));
    // Ordering: Promise.all (the actual call site) comes before the LAST
    // occurrence of router.refresh() — using lastIndexOf to skip docstring
    // mentions of router.refresh higher in the file.
    const promiseIdx = STAGE_DATA_PROVIDER.indexOf("Promise.all");
    const refreshIdx = STAGE_DATA_PROVIDER.lastIndexOf("router.refresh()");
    assert.ok(
      promiseIdx >= 0 && refreshIdx > promiseIdx,
      "router.refresh() must run after Promise.all of registered refreshers",
    );
  });

  it("useCockpitAction awaits refreshStageData before resolving success", () => {
    assert.ok(USE_COCKPIT_ACTION.includes("await refreshStageData()"));
  });
});

describe("SPEC-05 V4 — DecisionStageView owns decision/conditions/overrides data", () => {
  it("DecisionStageView fetches /decision/latest, /conditions, /overrides via useStageJsonResource", () => {
    assert.ok(DECISION_VIEW.includes("/api/deals/${dealId}/decision/latest"));
    assert.ok(DECISION_VIEW.includes("/api/deals/${dealId}/conditions"));
    assert.ok(DECISION_VIEW.includes("/api/deals/${dealId}/overrides"));
    const occurrences = DECISION_VIEW.match(/useStageJsonResource/g) ?? [];
    assert.ok(
      occurrences.length >= 3,
      "DecisionStageView must use useStageJsonResource for at least 3 endpoints",
    );
  });

  for (const file of [
    "decision/DecisionSummaryPanel.tsx",
    "decision/ApprovalConditionsPanel.tsx",
    "decision/OverrideAuditPanel.tsx",
    "decision/DecisionLetterPanel.tsx",
  ]) {
    it(`${file} no longer fetches independently`, () => {
      const src = readFile(STAGE_VIEWS, file);
      assert.ok(!/fetch\s*\(/.test(src), `${file} must not call fetch`);
      assert.ok(
        !src.includes("useJsonFetch"),
        `${file} must not use useJsonFetch`,
      );
    });
  }
});

describe("SPEC-05 V5 — ClosingStageView owns conditions/post-close/exception data", () => {
  it("ClosingStageView fetches /conditions, /post-close, /financial-exceptions via useStageJsonResource", () => {
    assert.ok(CLOSING_VIEW.includes("/api/deals/${dealId}/conditions"));
    assert.ok(CLOSING_VIEW.includes("/api/deals/${dealId}/post-close"));
    assert.ok(CLOSING_VIEW.includes("/api/deals/${dealId}/financial-exceptions"));
  });

  for (const file of [
    "closing/ClosingConditionsPanel.tsx",
    "closing/PostCloseChecklistPanel.tsx",
    "closing/ExceptionTrackerPanel.tsx",
  ]) {
    it(`${file} no longer fetches independently`, () => {
      const src = readFile(STAGE_VIEWS, file);
      assert.ok(!/fetch\s*\(/.test(src), `${file} must not call fetch`);
      assert.ok(
        !src.includes("useJsonFetch"),
        `${file} must not use useJsonFetch`,
      );
    });
  }
});

describe("SPEC-05 V6 — CommitteeStageView keeps single memo readiness fetch", () => {
  it("CommitteeStageView fetches /credit-memo/canonical/missing exactly once", () => {
    const occurrences =
      COMMITTEE_VIEW.match(/\/credit-memo\/canonical\/missing/g) ?? [];
    assert.equal(occurrences.length, 1);
  });
});

describe("SPEC-05 V7 — useStageJsonResource exposes loading/error/refresh/setOptimisticData", () => {
  it("type contract includes all four observable surfaces", () => {
    assert.ok(USE_STAGE_JSON_RESOURCE.includes("data: T | null"));
    assert.ok(USE_STAGE_JSON_RESOURCE.includes("loading: boolean"));
    assert.ok(USE_STAGE_JSON_RESOURCE.includes("error: string | null"));
    assert.ok(USE_STAGE_JSON_RESOURCE.includes("refresh: () => Promise<void>"));
    assert.ok(USE_STAGE_JSON_RESOURCE.includes("setOptimisticData"));
  });

  it("registers itself with the StageDataProvider", () => {
    assert.ok(USE_STAGE_JSON_RESOURCE.includes("useRegisterStageRefresher"));
  });
});

describe("SPEC-05 V8-V11 — optimistic feedback messages for the four ServerActionTypes", () => {
  const cases: { actionType: ServerActionType; substring: string }[] = [
    { actionType: "generate_packet", substring: "Packet generation started" },
    { actionType: "generate_snapshot", substring: "Snapshot recompute requested" },
    { actionType: "run_ai_classification", substring: "Classification queued" },
    { actionType: "send_reminder", substring: "Reminder sent" },
  ];
  for (const { actionType, substring } of cases) {
    it(`OPTIMISTIC_MESSAGES["${actionType}"] contains "${substring}"`, () => {
      assert.match(ACTION_FEEDBACK, new RegExp(`${actionType}.*${substring}`));
    });
  }

  it("PrimaryActionBar wires OPTIMISTIC_MESSAGES into ActionFeedback", () => {
    assert.ok(PRIMARY_ACTION_BAR.includes("OPTIMISTIC_MESSAGES"));
    assert.ok(PRIMARY_ACTION_BAR.includes("<ActionFeedback"));
    assert.ok(PRIMARY_ACTION_BAR.includes("optimisticMessage="));
  });

  it("CommitteePackagePanel renders ActionFeedback with packet optimistic message", () => {
    assert.ok(COMMITTEE_PACKAGE_PANEL.includes("<ActionFeedback"));
    assert.ok(
      COMMITTEE_PACKAGE_PANEL.includes("OPTIMISTIC_MESSAGES.generate_packet"),
    );
  });

  it("StageBlockerList wires ActionFeedback per blocker", () => {
    assert.ok(STAGE_BLOCKER_LIST.includes("<ActionFeedback"));
    assert.ok(STAGE_BLOCKER_LIST.includes("OPTIMISTIC_MESSAGES"));
  });
});

describe("SPEC-05 V12 — unknown actionType returns structured error without fetch", () => {
  it("isKnownActionType returns false for an unknown string", () => {
    assert.equal(isKnownActionType("not_a_real_action"), false);
  });

  it("runCockpitAction returns ok=false and never calls fetch for unknown actionType", async () => {
    let fetchCalls = 0;
    const action = {
      intent: "runnable",
      label: "Bogus",
      // Cast through unknown to bypass the compile-time enum and exercise
      // the runtime guard.
      actionType: "not_a_real_action" as unknown as ServerActionType,
    } as CockpitRunnableAction;
    const result = await runCockpitAction(action, "deal-1", (async () => {
      fetchCalls++;
      return new Response("{}");
    }) as unknown as typeof fetch);
    assert.equal(fetchCalls, 0);
    assert.equal(result.ok, false);
    assert.match(result.errorMessage ?? "", /unknown_action_type/);
  });
});

describe("SPEC-05 V13 — every ServerActionType has an explicit endpoint mapping", () => {
  const expectedMap: Record<ServerActionType, string> = {
    generate_packet: "/api/deals/deal-1/committee/packet/generate",
    generate_snapshot: "/api/deals/deal-1/financial-snapshot/recompute",
    run_ai_classification: "/api/deals/deal-1/artifacts/process",
    send_reminder: "/api/deals/deal-1/notifications/remind",
  };
  for (const [actionType, expected] of Object.entries(expectedMap) as [
    ServerActionType,
    string,
  ][]) {
    it(`${actionType} → ${expected}`, () => {
      assert.equal(endpointFor(actionType, "deal-1"), expected);
    });
  }
});

describe("SPEC-05 V14 — telemetry failure does not fail the action", () => {
  it("logCockpitAction swallows fetch errors via .catch()", () => {
    assert.match(
      LOG_COCKPIT_ACTION,
      /\.catch\(\(?[\w_]*\)?\s*=>/,
      "telemetry post must always handle rejections",
    );
  });

  it("logCockpitAction validates payloads and drops invalid ones", () => {
    assert.ok(LOG_COCKPIT_ACTION.includes("isValidEvent"));
    assert.ok(LOG_COCKPIT_ACTION.includes("invalid telemetry payload"));
  });

  it("logCockpitAction warns in dev without throwing", () => {
    assert.match(LOG_COCKPIT_ACTION, /process\.env\.NODE_ENV !== "production"/);
    assert.ok(LOG_COCKPIT_ACTION.includes("console.warn"));
  });
});

describe("SPEC-05 V15 — stage_data_refreshed telemetry after successful refresh", () => {
  it("logStageDataRefreshed exists and is invoked from useCockpitAction success branch", () => {
    assert.ok(LOG_COCKPIT_ACTION.includes("logStageDataRefreshed"));
    assert.ok(LOG_COCKPIT_ACTION.includes("stage_data_refreshed"));
    assert.ok(USE_COCKPIT_ACTION.includes("logStageDataRefreshed"));
  });
});

describe("SPEC-05 V16 — PrimaryActionBar still renders a single shared action surface", () => {
  it("StageWorkspaceShell renders <PrimaryActionBar/> exactly once", () => {
    const shell = readFile(SHARED, "StageWorkspaceShell.tsx");
    const matches = shell.match(/<PrimaryActionBar\b/g) ?? [];
    assert.equal(matches.length, 1);
  });

  it("no stage view renders <PrimaryActionBar/> directly", () => {
    for (const [name, src] of Object.entries(ALL_STAGE_VIEWS)) {
      assert.ok(
        !src.includes("<PrimaryActionBar"),
        `${name} must not render <PrimaryActionBar> directly`,
      );
    }
  });
});

describe("SPEC-05 V17 — StageBlockerList still routes fixes through useCockpitAction", () => {
  it("StageBlockerList uses useCockpitAction (executable, not just a Link)", () => {
    assert.ok(STAGE_BLOCKER_LIST.includes("useCockpitAction"));
    assert.match(
      STAGE_BLOCKER_LIST,
      /<button[\s\S]*data-testid="blocker-fix-action"/,
    );
  });
});

describe("SPEC-05 V18 — ForceAdvancePanel remains inside closed AdvancedDisclosure", () => {
  for (const [name, src] of Object.entries(ALL_STAGE_VIEWS)) {
    it(`${name}: ForceAdvancePanel nested inside <AdvancedDisclosure>`, () => {
      const fa = src.indexOf("<ForceAdvancePanel");
      if (fa < 0) return;

      // Pattern A — both in the same function body: ForceAdvancePanel sits
      // textually between <AdvancedDisclosure> and </AdvancedDisclosure>.
      const ad = src.lastIndexOf("<AdvancedDisclosure", fa);
      const closeAd = src.indexOf("</AdvancedDisclosure>", ad);
      const directlyNested =
        ad >= 0 && fa > ad && (closeAd === -1 || fa < closeAd);
      if (directlyNested) return;

      // Pattern B — extracted Advanced body component (e.g.
      // DocumentsAdvancedBody / UnderwritingAdvancedBody) rendered as
      // <AdvancedDisclosure> children. The body component lives below
      // the JSX but is referenced inside the disclosure.
      const advancedBodyMatch = src.match(/(\w+AdvancedBody)\b/);
      assert.ok(
        advancedBodyMatch,
        `${name}: ForceAdvancePanel must live inside <AdvancedDisclosure> or an extracted *AdvancedBody component`,
      );
      const bodyName = advancedBodyMatch![1];
      assert.ok(
        src.includes(`<AdvancedDisclosure`) &&
          new RegExp(`<${bodyName}\\b`).test(src),
        `${name}: ${bodyName} must be referenced inside <AdvancedDisclosure>`,
      );
    });
  }

  it("AdvancedDisclosure remains closed by default", () => {
    const ad = readFile(SHARED, "AdvancedDisclosure.tsx");
    assert.ok(ad.includes("<details"));
    assert.ok(!/<details[^>]*\bopen\b/.test(ad));
  });
});

describe("SPEC-05 V7 (extra) — useStageJsonResource setOptimisticData behavior", () => {
  it("setOptimisticData uses an updater function signature", () => {
    assert.match(
      USE_STAGE_JSON_RESOURCE,
      /setOptimisticData:\s*\(updater:[\s\S]*=> T \| null\)/,
    );
  });
});
