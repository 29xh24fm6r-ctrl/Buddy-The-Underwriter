import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const ACTIONS = path.resolve(__dirname, "..", "actions");
const ROOT_API = path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const STAGE_DATA_PROVIDER = read(SHARED, "StageDataProvider.tsx");
const USE_STAGE_DATA_REFRESH = read(SHARED, "useStageDataRefresh.ts");
const USE_STAGE_JSON_RESOURCE = read(SHARED, "useStageJsonResource.ts");
const ACTION_FEEDBACK = read(SHARED, "ActionFeedback.tsx");

const USE_INLINE_MUTATION = read(ACTIONS, "useInlineMutation.ts");
const USE_COCKPIT_ACTION = read(ACTIONS, "useCockpitAction.ts");
const LOG_COCKPIT_ACTION = read(ACTIONS, "logCockpitAction.ts");
const PRIMARY_ACTION_BAR = read(SHARED, "PrimaryActionBar.tsx");
const STAGE_BLOCKER_LIST = read(SHARED, "StageBlockerList.tsx");

const DECISION_VIEW = read(STAGE_VIEWS, "DecisionStageView.tsx");
const CLOSING_VIEW = read(STAGE_VIEWS, "ClosingStageView.tsx");
const DOCUMENTS_VIEW = read(STAGE_VIEWS, "DocumentsStageView.tsx");
const UNDERWRITING_VIEW = read(STAGE_VIEWS, "UnderwritingStageView.tsx");

const CONDITIONS_EDITOR = read(STAGE_VIEWS, "conditions/ConditionsInlineEditor.tsx");
const OVERRIDE_EDITOR = read(STAGE_VIEWS, "decision/OverrideInlineEditor.tsx");

describe("SPEC-06 V1 — Documents stage no longer relies SOLELY on key={refreshSeq}", () => {
  it("DocumentsStageView mounts at least one stage-owned surface that uses useStageJsonResource", () => {
    assert.ok(DOCUMENTS_VIEW.includes("<DocumentChecklistSurface"));
    assert.ok(DOCUMENTS_VIEW.includes("<IntakeReviewSurface"));
    assert.ok(DOCUMENTS_VIEW.includes("<UploadRequestSurface"));
  });

  it("each Documents surface registers under scope: 'documents'", () => {
    for (const file of [
      "documents/DocumentChecklistSurface.tsx",
      "documents/IntakeReviewSurface.tsx",
      "documents/UploadRequestSurface.tsx",
    ]) {
      const src = read(STAGE_VIEWS, file);
      assert.ok(src.includes("useStageJsonResource"));
      assert.ok(src.includes('scope: "documents"'));
    }
  });
});

describe("SPEC-06 V2 — Underwriting stage no longer remounts the whole body", () => {
  it("UnderwritingStageView splits lifted summary surfaces from the legacy block", () => {
    assert.ok(UNDERWRITING_VIEW.includes("<RiskSummarySurface"));
    assert.ok(UNDERWRITING_VIEW.includes("<BankerVoiceSurface"));
    assert.ok(UNDERWRITING_VIEW.includes("<UnderwritingActionsSurface"));
  });

  it("the legacy block has its own remount key, not a body-level one", () => {
    // Body-level wrapper is no longer the only thing keyed; the legacy
    // section uses key=`underwriting-legacy-${refreshSeq}` and the lifted
    // surfaces live above it (un-keyed at body level).
    assert.match(UNDERWRITING_VIEW, /key=\{`underwriting-legacy-\$\{refreshSeq\}`\}/);
    assert.ok(!UNDERWRITING_VIEW.includes("`underwriting-stage-${refreshSeq}`"));
  });
});

describe("SPEC-06 V3/V4 — ConditionsInlineEditor renders in Decision and Closing", () => {
  it("DecisionStageView mounts <ConditionsInlineEditor surface=\"decision\">", () => {
    assert.ok(DECISION_VIEW.includes("<ConditionsInlineEditor"));
    assert.ok(DECISION_VIEW.includes('surface="decision"'));
  });

  it("ClosingStageView mounts <ConditionsInlineEditor surface=\"closing\">", () => {
    assert.ok(CLOSING_VIEW.includes("<ConditionsInlineEditor"));
    assert.ok(CLOSING_VIEW.includes('surface="closing"'));
  });
});

describe("SPEC-06 V5-V8 — Conditions optimistic mutations", () => {
  it("V5: Add condition uses optimistic insert via setOptimisticData", () => {
    assert.ok(CONDITIONS_EDITOR.includes("function handleAdd"));
    assert.ok(CONDITIONS_EDITOR.includes("setOptimisticData"));
    assert.ok(CONDITIONS_EDITOR.includes("/conditions/add"));
  });

  it("V6: Mark satisfied calls /conditions/set-status", () => {
    assert.ok(CONDITIONS_EDITOR.includes('handleStatus'));
    assert.ok(CONDITIONS_EDITOR.includes('"satisfied"'));
    assert.ok(CONDITIONS_EDITOR.includes("/conditions/set-status"));
  });

  it("V7: Mark waived calls /conditions/set-status", () => {
    assert.ok(CONDITIONS_EDITOR.includes('"waived"'));
  });

  it("V8: Edit note PATCHes /conditions/[id]", () => {
    assert.ok(CONDITIONS_EDITOR.includes("function handleSaveNote"));
    assert.match(CONDITIONS_EDITOR, /method:\s*"PATCH"/);
    assert.match(CONDITIONS_EDITOR, /\/conditions\/\$\{row\.id\}/);
  });
});

describe("SPEC-06 V9 — Condition mutations refresh only scope='conditions'", () => {
  it("ConditionsInlineEditor declares domain: 'conditions' on every mutation", () => {
    const matches = CONDITIONS_EDITOR.match(/domain:\s*"conditions"/g) ?? [];
    assert.ok(matches.length >= 3, "expected at least 3 conditions-domain mutations");
  });

  it("useInlineMutation maps domain → scope (conditions → 'conditions')", () => {
    assert.match(USE_INLINE_MUTATION, /conditions:\s*"conditions"/);
    assert.ok(USE_INLINE_MUTATION.includes("refreshStageData(scope)"));
  });
});

describe("SPEC-06 V10-V13 — Override editor in Decision", () => {
  it("V10: DecisionStageView mounts <OverrideInlineEditor>", () => {
    assert.ok(DECISION_VIEW.includes("<OverrideInlineEditor"));
  });

  it("V11: Add override uses optimistic insert via setOptimisticData", () => {
    assert.ok(OVERRIDE_EDITOR.includes("function handleAdd"));
    assert.ok(OVERRIDE_EDITOR.includes("setOptimisticData"));
    // Add path: fetch(`/api/deals/${dealId}/overrides`, { method: "POST", ... })
    assert.match(
      OVERRIDE_EDITOR,
      /fetch\(`\/api\/deals\/\$\{dealId\}\/overrides`,[\s\S]{0,200}method:\s*"POST"/,
    );
  });

  it("V12: Edit override rationale PATCHes /overrides/[id]", () => {
    assert.ok(OVERRIDE_EDITOR.includes("function handleSaveReason"));
    assert.match(OVERRIDE_EDITOR, /method:\s*"PATCH"/);
    assert.match(OVERRIDE_EDITOR, /\/overrides\/\$\{row\.id\}/);
  });

  it("V13: Mark reviewed POSTs /overrides/[id]/review", () => {
    assert.ok(OVERRIDE_EDITOR.includes("function handleMarkReviewed"));
    assert.match(OVERRIDE_EDITOR, /\/overrides\/\$\{row\.id\}\/review/);
  });
});

describe("SPEC-06 V14 — Override mutations refresh only scope='overrides'", () => {
  it("OverrideInlineEditor declares domain: 'overrides' on every mutation", () => {
    const matches = OVERRIDE_EDITOR.match(/domain:\s*"overrides"/g) ?? [];
    assert.ok(matches.length >= 3, "expected at least 3 overrides-domain mutations");
  });
});

describe("SPEC-06 V15-V17 — Scoped refresh API", () => {
  it("V15: refreshStageData calls only scope-specific + 'all' bucket refreshers", () => {
    // Implementation runs Promise.all over (all bucket + specific bucket).
    assert.match(STAGE_DATA_PROVIDER, /bucketsRef\.current\.get\("all"\)/);
    assert.match(STAGE_DATA_PROVIDER, /bucketsRef\.current\.get\(requested\)/);
  });

  it("V16: refreshStageData('all') drains every bucket", () => {
    assert.match(
      STAGE_DATA_PROVIDER,
      /requested === "all"[\s\S]*for \(const b of bucketsRef\.current\.values\(\)\)/,
    );
  });

  it("V17: unknown scope falls back to 'all' without crashing", () => {
    assert.match(
      STAGE_DATA_PROVIDER,
      /KNOWN_SCOPES\.has\(scope\)\s*\?\s*scope\s*:\s*"all"/,
    );
  });

  it("registerRefresher accepts (scope, id, fn) and legacy (id, fn) shapes", () => {
    assert.match(STAGE_DATA_PROVIDER, /typeof idOrFn === "function"/);
    assert.ok(STAGE_DATA_PROVIDER.includes('Backward-compat shape'));
  });

  it("useStageDataRefresh signature accepts an optional scope arg", () => {
    assert.match(USE_STAGE_DATA_REFRESH, /scope\?:\s*StageRefreshScope/);
    assert.ok(USE_STAGE_DATA_REFRESH.includes("Promise<void>"));
  });

  it("useStageJsonResource accepts a scope option (default 'all')", () => {
    assert.match(USE_STAGE_JSON_RESOURCE, /scope\?: StageRefreshScope/);
    assert.match(USE_STAGE_JSON_RESOURCE, /scope = "all"/);
  });
});

describe("SPEC-06 V18 — Inline mutation telemetry tags source='stage_cockpit'", () => {
  it("logInlineMutationStarted/Result emit canonical kinds with source", () => {
    assert.ok(LOG_COCKPIT_ACTION.includes("cockpit_inline_mutation_started"));
    assert.ok(LOG_COCKPIT_ACTION.includes("cockpit_inline_mutation_succeeded"));
    assert.ok(LOG_COCKPIT_ACTION.includes("cockpit_inline_mutation_failed"));
    assert.ok(LOG_COCKPIT_ACTION.includes('source: "stage_cockpit"'));
  });

  it("useInlineMutation invokes both started and result telemetry", () => {
    assert.ok(USE_INLINE_MUTATION.includes("logInlineMutationStarted"));
    assert.ok(USE_INLINE_MUTATION.includes("logInlineMutationResult"));
  });
});

describe("SPEC-06 V19 — Failed mutation reverts optimistic state", () => {
  it("useInlineMutation calls revert() and surfaces error on failure", () => {
    assert.ok(USE_INLINE_MUTATION.includes("opts.revert()"));
    assert.ok(USE_INLINE_MUTATION.includes('status: "error"'));
  });

  it("ConditionsInlineEditor passes a revert closure to every mutation", () => {
    const reverts = CONDITIONS_EDITOR.match(/revert:\s*\(\)\s*=>/g) ?? [];
    assert.ok(reverts.length >= 3, "expected revert callbacks on every mutation");
    assert.ok(CONDITIONS_EDITOR.includes("setOptimisticData(() => previous)"));
  });

  it("OverrideInlineEditor passes a revert closure to every mutation", () => {
    const reverts = OVERRIDE_EDITOR.match(/revert:\s*\(\)\s*=>/g) ?? [];
    assert.ok(reverts.length >= 3);
    assert.ok(OVERRIDE_EDITOR.includes("setOptimisticData(() => previous)"));
  });
});

describe("SPEC-06 V20-V21 — PrimaryActionBar + StageBlockerList still use shared runner", () => {
  it("PrimaryActionBar uses useCockpitAction", () => {
    assert.ok(PRIMARY_ACTION_BAR.includes("useCockpitAction"));
  });

  it("StageBlockerList uses useCockpitAction", () => {
    assert.ok(STAGE_BLOCKER_LIST.includes("useCockpitAction"));
  });
});

describe("SPEC-06 V22 — ForceAdvancePanel inside closed AdvancedDisclosure", () => {
  for (const [name, src] of Object.entries({
    DecisionStageView: DECISION_VIEW,
    ClosingStageView: CLOSING_VIEW,
    DocumentsStageView: DOCUMENTS_VIEW,
    UnderwritingStageView: UNDERWRITING_VIEW,
  })) {
    it(`${name}: ForceAdvancePanel appears only inside <AdvancedDisclosure> or *AdvancedBody`, () => {
      const fa = src.indexOf("<ForceAdvancePanel");
      if (fa < 0) return;
      const ad = src.lastIndexOf("<AdvancedDisclosure", fa);
      const closeAd = src.indexOf("</AdvancedDisclosure>", ad);
      const directlyNested =
        ad >= 0 && fa > ad && (closeAd === -1 || fa < closeAd);
      if (directlyNested) return;
      const body = src.match(/(\w+AdvancedBody)\b/);
      assert.ok(
        body && src.includes("<AdvancedDisclosure"),
        `${name}: ForceAdvancePanel must live inside <AdvancedDisclosure>`,
      );
    });
  }
});

describe("SPEC-06 — endpoints exist for inline edits", () => {
  it("POST /api/deals/[dealId]/conditions/add route exists", () => {
    assert.ok(
      fs.existsSync(path.resolve(ROOT_API, "conditions/add/route.ts")),
    );
  });

  it("PATCH /api/deals/[dealId]/conditions/[conditionId] route exists", () => {
    assert.ok(
      fs.existsSync(
        path.resolve(ROOT_API, "conditions/[conditionId]/route.ts"),
      ),
    );
  });

  it("PATCH /api/deals/[dealId]/overrides/[overrideId] route exists", () => {
    assert.ok(
      fs.existsSync(path.resolve(ROOT_API, "overrides/[overrideId]/route.ts")),
    );
  });

  it("POST /api/deals/[dealId]/overrides/[overrideId]/review route exists", () => {
    assert.ok(
      fs.existsSync(
        path.resolve(ROOT_API, "overrides/[overrideId]/review/route.ts"),
      ),
    );
  });
});

describe("SPEC-06 — useCockpitAction still wires stage_data_refreshed", () => {
  it("useCockpitAction invokes refreshStageData and logStageDataRefreshed", () => {
    assert.ok(USE_COCKPIT_ACTION.includes("refreshStageData"));
    assert.ok(USE_COCKPIT_ACTION.includes("logStageDataRefreshed"));
  });

  it("ActionFeedback still drives optimistic messaging from OPTIMISTIC_MESSAGES", () => {
    assert.ok(ACTION_FEEDBACK.includes("OPTIMISTIC_MESSAGES"));
  });
});
