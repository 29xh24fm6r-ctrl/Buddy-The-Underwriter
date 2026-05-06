import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildCockpitAdvisorSignals,
  type AdvisorConditionRow,
  type AdvisorOverrideRow,
  type AdvisorTelemetryEvent,
} from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import type { LifecycleState } from "@/buddy/lifecycle/model";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const ACTIONS = path.resolve(__dirname, "..", "actions");
const ROOT_API = path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const STAGE_DATA_PROVIDER = read(SHARED, "StageDataProvider.tsx");
const USE_STAGE_DATA_REFRESH = read(SHARED, "useStageDataRefresh.ts");
const USE_INLINE_MUTATION = read(ACTIONS, "useInlineMutation.ts");
const LOG_COCKPIT_ACTION = read(ACTIONS, "logCockpitAction.ts");
const ADVISOR_BUILDER = read(
  __dirname,
  "..",
  "..",
  "..",
  "lib",
  "journey",
  "advisor",
  "buildCockpitAdvisorSignals.ts",
);
const ADVISOR_PANEL = read(SHARED, "CockpitAdvisorPanel.tsx");

const CONDITIONS_EDITOR = read(
  STAGE_VIEWS,
  "conditions/ConditionsInlineEditor.tsx",
);
const OVERRIDE_EDITOR = read(STAGE_VIEWS, "decision/OverrideInlineEditor.tsx");
const CONDITIONS_LIST_ROUTE = read(
  ROOT_API,
  "conditions/list/route.ts",
);
const CONDITIONS_ROUTE = read(ROOT_API, "conditions/route.ts");

const STAGE_VIEW_FILES = [
  "DocumentsStageView.tsx",
  "UnderwritingStageView.tsx",
  "CommitteeStageView.tsx",
  "DecisionStageView.tsx",
  "ClosingStageView.tsx",
];

// ─── V1-V4: scoped refresh ─────────────────────────────────────────

describe("SPEC-07 V1-V4 — strict scoped refresh", () => {
  it("V1: refreshStageData('conditions') runs only conditions refreshers", () => {
    // Strict-by-default: the "all" bucket only joins when includeGlobal=true.
    // The implementation must show the scope-only branch first.
    assert.ok(
      STAGE_DATA_PROVIDER.includes("if (options?.includeGlobal)"),
      "scope-only path must be the default; 'all' bucket joins only on includeGlobal",
    );
  });

  it("V2: scope-specific buckets are isolated under strict semantics", () => {
    // Scope draining loops over a single bucket only when includeGlobal is
    // false / undefined.
    assert.match(
      STAGE_DATA_PROVIDER,
      /const specific = bucketsRef\.current\.get\(requested\)/,
    );
  });

  it("V3: refreshStageData('all') drains every bucket", () => {
    assert.match(
      STAGE_DATA_PROVIDER,
      /requested === "all"[\s\S]*for \(const b of bucketsRef\.current\.values\(\)\)/,
    );
  });

  it("V4: unknown scope falls back to 'all' safely", () => {
    assert.match(STAGE_DATA_PROVIDER, /KNOWN_SCOPES\.has\(scope\)/);
    assert.match(STAGE_DATA_PROVIDER, /\?\s*scope\s*:\s*"all"/);
  });

  it("StageRefreshOptions type accepts includeGlobal flag", () => {
    assert.ok(STAGE_DATA_PROVIDER.includes("includeGlobal?: boolean"));
    assert.ok(USE_STAGE_DATA_REFRESH.includes("StageRefreshOptions"));
  });
});

// ─── V5-V6: conditions API normalization ───────────────────────────

describe("SPEC-07 V5-V6 — conditions API normalization", () => {
  it("V5: /conditions/list returns canonical `conditions` (with deprecated `items` alias)", () => {
    assert.match(CONDITIONS_LIST_ROUTE, /conditions,\s*items:\s*conditions/);
  });

  it("V5: /conditions still returns `conditions`", () => {
    assert.match(CONDITIONS_ROUTE, /conditions:\s*data\s*\?\?\s*\[\]/);
  });

  it("V6: ConditionsInlineEditor consumes normalized `{ conditions }` shape", () => {
    assert.ok(
      /current\?\.conditions\s*\?\?\s*current\?\.items/.test(CONDITIONS_EDITOR),
      "editor must prefer `conditions`, fall back to `items` during deprecation",
    );
  });
});

// ─── V7-V14: undo + reconcile ──────────────────────────────────────

describe("SPEC-07 V7-V14 — undoable mutations + flicker-free reconcile", () => {
  it("V7: condition status mutation declares an undo", () => {
    // Find handleStatus and confirm it includes an `undo:` block.
    const idx = CONDITIONS_EDITOR.indexOf("function handleStatus");
    const next = CONDITIONS_EDITOR.indexOf("function handleSaveNote", idx);
    const slice = CONDITIONS_EDITOR.slice(idx, next > 0 ? next : undefined);
    assert.match(slice, /undo:\s*\{/);
  });

  it("V8: undo condition status calls a compensating /set-status", () => {
    const idx = CONDITIONS_EDITOR.indexOf("function handleStatus");
    const slice = CONDITIONS_EDITOR.slice(idx, idx + 4000);
    // The undo's request should also POST /conditions/set-status with the
    // previous status — same endpoint, different payload.
    assert.match(
      slice,
      /undo:[\s\S]*\/conditions\/set-status[\s\S]*status:\s*prevStatus/,
    );
  });

  it("V9: condition note edit declares an undo", () => {
    const idx = CONDITIONS_EDITOR.indexOf("function handleSaveNote");
    const slice = CONDITIONS_EDITOR.slice(idx, idx + 4000);
    assert.match(slice, /undo:\s*\{/);
    assert.match(slice, /Undo note edit/);
  });

  it("V10: override rationale edit declares an undo", () => {
    const idx = OVERRIDE_EDITOR.indexOf("function handleSaveReason");
    const slice = OVERRIDE_EDITOR.slice(idx, idx + 4000);
    assert.match(slice, /undo:\s*\{/);
    assert.match(slice, /Undo rationale edit/);
  });

  it("V11: override mark-reviewed declares an undo (PATCH requires_review)", () => {
    const idx = OVERRIDE_EDITOR.indexOf("function handleMarkReviewed");
    const slice = OVERRIDE_EDITOR.slice(idx, idx + 4000);
    assert.match(slice, /undo:\s*\{/);
    assert.match(slice, /requires_review:\s*prevRequiresReview/);
  });

  it("V12: new condition insert does NOT declare an undo (no delete endpoint)", () => {
    const idx = CONDITIONS_EDITOR.indexOf("function handleAdd");
    const next = CONDITIONS_EDITOR.indexOf("function handleStatus", idx);
    const slice = CONDITIONS_EDITOR.slice(idx, next);
    assert.ok(
      !/undo:\s*\{/.test(slice),
      "Add path must not surface an undo until a delete endpoint exists",
    );
  });

  it("V13: useInlineMutation reconciles canonical entity from server response", () => {
    // The reconcile path skips the immediate refresh when reconcile() returns true.
    assert.ok(USE_INLINE_MUTATION.includes("reconcile?: ReconcileFn"));
    assert.match(USE_INLINE_MUTATION, /reconciled = opts\.reconcile\(serverJson\)/);
    assert.match(
      USE_INLINE_MUTATION,
      /if \(!reconciled\)\s*\{\s*[\s\S]*await refreshStageData\(scope\)/,
    );
  });

  it("V14: hard refresh runs only when reconcile is missing or returned false", () => {
    // Same path as V13: refresh is gated by `if (!reconciled)`.
    assert.match(USE_INLINE_MUTATION, /if \(!reconciled\)/);
  });

  it("V15: undo events emit cockpit_inline_mutation_undone telemetry", () => {
    assert.ok(LOG_COCKPIT_ACTION.includes("cockpit_inline_mutation_undone"));
    assert.ok(LOG_COCKPIT_ACTION.includes("logInlineMutationUndone"));
    assert.ok(USE_INLINE_MUTATION.includes("logInlineMutationUndone"));
  });
});

// ─── V16: advisor panel mounted in every stage ─────────────────────

describe("SPEC-07 V16 — CockpitAdvisorPanel renders across stages", () => {
  for (const file of STAGE_VIEW_FILES) {
    it(`${file} mounts <CockpitAdvisorPanel>`, () => {
      const src = read(STAGE_VIEWS, file);
      assert.ok(
        src.includes("<CockpitAdvisorPanel"),
        `${file} must mount CockpitAdvisorPanel`,
      );
    });
  }
});

// ─── V17-V23: advisor signal builder is deterministic ─────────────

const baseDerived = {
  documentsReady: true,
  documentsReadinessPct: 100,
  underwriteStarted: false,
  financialSnapshotExists: false,
  committeePacketReady: false,
  decisionPresent: false,
  committeeRequired: false,
  pricingQuoteReady: false,
  riskPricingFinalized: false,
  attestationSatisfied: true,
  aiPipelineComplete: true,
  spreadsComplete: true,
  structuralPricingReady: false,
  hasPricingAssumptions: false,
  hasSubmittedLoanRequest: false,
  hasLoanRequestWithAmount: false,
  researchComplete: true,
  criticalFlagsResolved: true,
};

function makeState(
  overrides: Partial<LifecycleState> = {},
): LifecycleState {
  return {
    stage: "underwrite_ready",
    lastAdvancedAt: null,
    blockers: [],
    derived: baseDerived,
    ...overrides,
  };
}

describe("SPEC-07 V17-V23 — advisor signal builder", () => {
  it("V17: emits next_best_action from lifecycle action when unblocked", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
    });
    const next = signals.find((s) => s.kind === "next_best_action");
    assert.ok(next, "should emit next_best_action");
    assert.equal(next!.source, "lifecycle");
    assert.ok(next!.action, "next_best_action should carry a CockpitAction");
  });

  it("V18: emits blocked_reason for each lifecycle blocker", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [
          { code: "decision_missing", message: "Decision is missing" },
          { code: "attestation_missing", message: "Attestations missing" },
        ],
      }),
    });
    const blocked = signals.filter((s) => s.kind === "blocked_reason");
    assert.equal(blocked.length, 2);
    assert.equal(blocked[0].source, "blockers");
  });

  it("V19: emits readiness_warning for low document readiness", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: { ...baseDerived, documentsReadinessPct: 40, documentsReady: false },
      }),
    });
    const warn = signals.find((s) => s.kind === "readiness_warning");
    assert.ok(warn, "should emit readiness_warning when pct < 60");
    assert.equal(warn!.severity, "warning");
    assert.equal(warn!.source, "documents");
  });

  it("V19: high-but-not-100 readiness emits info-severity warning", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: { ...baseDerived, documentsReadinessPct: 80 },
      }),
    });
    const warn = signals.find((s) => s.kind === "readiness_warning");
    assert.ok(warn);
    assert.equal(warn!.severity, "info");
  });

  it("V20: emits risk_warning from unresolved overrides", () => {
    const overrides: AdvisorOverrideRow[] = [
      { id: "o1", requires_review: true },
      { id: "o2", requires_review: true },
      { id: "o3", requires_review: true },
      { id: "o4", requires_review: false },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      overrides,
    });
    const risk = signals.find(
      (s) => s.kind === "risk_warning" && s.source === "overrides",
    );
    assert.ok(risk, "should emit risk_warning for unresolved overrides");
    assert.equal(risk!.severity, "critical"); // 3 reviewable → critical
  });

  it("V20: emits risk_warning from open required conditions", () => {
    const conditions: AdvisorConditionRow[] = [
      { id: "c1", severity: "REQUIRED", status: "OPEN", title: "x" },
      { id: "c2", severity: "REQUIRED", status: "SATISFIED", title: "y" },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      conditions,
    });
    const risk = signals.find(
      (s) => s.kind === "risk_warning" && s.source === "conditions",
    );
    assert.ok(risk);
    assert.equal(risk!.severity, "warning"); // 1 open → warning
  });

  it("V20: emits risk_warning from memo gaps", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      memoSummary: {
        required_keys: ["A", "B", "C", "D", "E", "F"],
        present_keys: ["A"],
        missing_keys: ["B", "C", "D", "E", "F"],
      },
    });
    const risk = signals.find(
      (s) => s.kind === "risk_warning" && s.source === "memo",
    );
    assert.ok(risk);
    assert.equal(risk!.severity, "critical");
  });

  it("V21: emits recent_change from recent telemetry", () => {
    const now = 1_000_000_000_000;
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_action_succeeded", ts: now - 60_000, label: "Generate Packet" },
      { type: "stage_data_refreshed", ts: now - 30_000 },
      { type: "cockpit_inline_mutation_succeeded", ts: now - 10_000, label: "Mark satisfied" },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const recents = signals.filter((s) => s.kind === "recent_change");
    assert.equal(recents.length, 2, "stage_data_refreshed should be filtered out");
    assert.ok(recents.every((s) => s.source === "telemetry"));
  });

  it("V21: stale telemetry events fall outside the window", () => {
    const now = 1_000_000_000_000;
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_action_succeeded", ts: now - 10 * 60_000 }, // 10m old
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    assert.equal(signals.filter((s) => s.kind === "recent_change").length, 0);
  });

  it("V22: builder is pure — no fetch/setTimeout/setInterval calls", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setInterval\s*\(/.test(ADVISOR_BUILDER));
  });

  it("V23: advisor actions reuse the CockpitAction shape", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({ derived: { ...baseDerived, documentsReadinessPct: 30 } }),
    });
    const withAction = signals.find((s) => s.action);
    assert.ok(withAction);
    const action = withAction!.action!;
    assert.ok(
      action.intent === "navigate" ||
        action.intent === "runnable" ||
        action.intent === "fix_blocker",
      "action.intent must be a CockpitActionIntent",
    );
  });

  it("blocked deal does NOT emit next_best_action (defers to blocked_reason)", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "decision_missing", message: "Decision missing" }],
      }),
    });
    assert.equal(
      signals.filter((s) => s.kind === "next_best_action").length,
      0,
    );
  });
});

// ─── V24-V27: invariants preserved ─────────────────────────────────

describe("SPEC-07 V24-V27 — preserved invariants", () => {
  it("V24: PrimaryActionBar still uses useCockpitAction", () => {
    const src = read(SHARED, "PrimaryActionBar.tsx");
    assert.ok(src.includes("useCockpitAction"));
  });

  it("V25: StageBlockerList still uses useCockpitAction", () => {
    const src = read(SHARED, "StageBlockerList.tsx");
    assert.ok(src.includes("useCockpitAction"));
  });

  it("V26: AdvancedDisclosure remains closed by default", () => {
    const src = read(SHARED, "AdvancedDisclosure.tsx");
    assert.ok(src.includes("<details"));
    assert.ok(!/<details[^>]*\bopen\b/.test(src));
  });

  it("V27: advisor panel does not call fetch (props-driven)", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_PANEL));
  });
});
