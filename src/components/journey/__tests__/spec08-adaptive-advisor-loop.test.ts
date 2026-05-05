import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildCockpitAdvisorSignals,
  type AdvisorTelemetryEvent,
} from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import { buildAdvisorMemorySummary } from "@/lib/journey/advisor/buildAdvisorMemorySummary";
import { isCockpitTelemetryType } from "@/components/journey/stageViews/_shared/useRecentCockpitTelemetry";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { DealConditionRow } from "@/lib/journey/contracts/conditions";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const ACTIONS = path.resolve(__dirname, "..", "actions");
const ROOT_API = path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]");
const LIB_JOURNEY = path.resolve(__dirname, "..", "..", "..", "lib", "journey");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const ADVISOR_BUILDER = read(LIB_JOURNEY, "advisor", "buildCockpitAdvisorSignals.ts");
const ADVISOR_MEMORY = read(LIB_JOURNEY, "advisor", "buildAdvisorMemorySummary.ts");
const ADVISOR_PANEL = read(SHARED, "CockpitAdvisorPanel.tsx");
const TELEMETRY_HOOK = read(SHARED, "useRecentCockpitTelemetry.ts");
const USE_INLINE_MUTATION = read(ACTIONS, "useInlineMutation.ts");
const CONDITIONS_EDITOR = read(STAGE_VIEWS, "conditions/ConditionsInlineEditor.tsx");
const OVERRIDE_EDITOR = read(STAGE_VIEWS, "decision/OverrideInlineEditor.tsx");
const SET_STATUS_ROUTE = read(ROOT_API, "conditions/set-status/route.ts");
const REVIEW_ROUTE = read(ROOT_API, "overrides/[overrideId]/review/route.ts");
const CONDITIONS_ROUTE = read(ROOT_API, "conditions/route.ts");
const CONDITIONS_LIST_ROUTE = read(ROOT_API, "conditions/list/route.ts");
const CONTRACT_TYPES = read(LIB_JOURNEY, "contracts/conditions.ts");

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

function makeState(overrides: Partial<LifecycleState> = {}): LifecycleState {
  return {
    stage: "underwrite_ready",
    lastAdvancedAt: null,
    blockers: [],
    derived: baseDerived,
    ...overrides,
  };
}

// ─── V1-V3: live telemetry hook ────────────────────────────────────

describe("SPEC-08 V1-V3 — useRecentCockpitTelemetry", () => {
  it("V1: hook fetches /api/buddy/signals/latest with dealId + limit", () => {
    assert.match(TELEMETRY_HOOK, /\/api\/buddy\/signals\/latest/);
    // URL template may span lines; check pieces independently.
    assert.ok(TELEMETRY_HOOK.includes("encodeURIComponent("));
    assert.ok(TELEMETRY_HOOK.includes("&limit="));
  });

  it("V2: hook filters out telemetry tagged for a different deal", () => {
    assert.match(TELEMETRY_HOOK, /row\.dealId\s*&&\s*row\.dealId\s*!==\s*dealId/);
  });

  it("V3: isCockpitTelemetryType accepts the four cockpit families and rejects others", () => {
    assert.equal(isCockpitTelemetryType("cockpit_action_started"), true);
    assert.equal(isCockpitTelemetryType("cockpit_action_succeeded"), true);
    assert.equal(isCockpitTelemetryType("blocker_fix_started"), true);
    assert.equal(isCockpitTelemetryType("blocker_fix_failed"), true);
    assert.equal(isCockpitTelemetryType("cockpit_inline_mutation_started"), true);
    assert.equal(isCockpitTelemetryType("cockpit_inline_mutation_undone"), true);
    assert.equal(isCockpitTelemetryType("stage_data_refreshed"), true);

    assert.equal(isCockpitTelemetryType("omega.signal"), false);
    assert.equal(isCockpitTelemetryType("identity.match.auto_attached"), false);
    assert.equal(isCockpitTelemetryType(null), false);
    assert.equal(isCockpitTelemetryType(""), false);
  });

  it("CockpitAdvisorPanel uses useRecentCockpitTelemetry by default", () => {
    assert.ok(ADVISOR_PANEL.includes("useRecentCockpitTelemetry"));
    assert.ok(ADVISOR_PANEL.includes("enabled: !props.recentTelemetry"));
  });
});

// ─── V4-V7: advisor memory summary ─────────────────────────────────

describe("SPEC-08 V4-V7 — buildAdvisorMemorySummary", () => {
  const now = 1_700_000_000_000;

  it("V4: detects last action", () => {
    const summary = buildAdvisorMemorySummary({
      now,
      recentTelemetry: [
        {
          type: "cockpit_action_succeeded",
          ts: now - 60_000,
          label: "generate_packet",
        },
      ],
    });
    assert.ok(summary.lastActionAt);
    assert.equal(summary.lastActionLabel, "generate_packet");
  });

  it("V5: detects last inline mutation", () => {
    const summary = buildAdvisorMemorySummary({
      now,
      recentTelemetry: [
        {
          type: "cockpit_inline_mutation_succeeded",
          ts: now - 30_000,
          label: "Mark satisfied",
        },
      ],
    });
    assert.ok(summary.lastMutationAt);
    assert.equal(summary.lastMutationSummary, "Mark satisfied");
  });

  it("V6: detects last undo", () => {
    const summary = buildAdvisorMemorySummary({
      now,
      recentTelemetry: [
        { type: "cockpit_inline_mutation_undone", ts: now - 5_000 },
      ],
    });
    assert.ok(summary.lastUndoAt);
  });

  it("V7: counts recent failures across all *_failed kinds", () => {
    const summary = buildAdvisorMemorySummary({
      now,
      recentTelemetry: [
        { type: "cockpit_action_failed", ts: now - 60_000 },
        { type: "blocker_fix_failed", ts: now - 30_000 },
        { type: "cockpit_inline_mutation_failed", ts: now - 5_000 },
        { type: "cockpit_action_succeeded", ts: now - 90_000 },
      ],
    });
    assert.equal(summary.recentFailures, 3);
  });

  it("counts recent blocker resolutions", () => {
    const summary = buildAdvisorMemorySummary({
      now,
      recentTelemetry: [
        { type: "blocker_fix_succeeded", ts: now - 10_000 },
        { type: "blocker_fix_succeeded", ts: now - 20_000 },
      ],
    });
    assert.equal(summary.recentlyResolvedBlockers, 2);
  });

  it("ignores events outside the window", () => {
    const summary = buildAdvisorMemorySummary({
      now,
      windowMs: 60_000,
      recentTelemetry: [
        {
          type: "cockpit_action_succeeded",
          ts: now - 5 * 60_000,
          label: "stale",
        },
      ],
    });
    assert.equal(summary.lastActionAt, undefined);
  });

  it("memory builder is pure (no fetch / setTimeout)", () => {
    assert.ok(!/fetch\s*\(/.test(ADVISOR_MEMORY));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_MEMORY));
  });
});

// ─── V8-V12: ranking + confidence ──────────────────────────────────

describe("SPEC-08 V8-V12 — ranking and confidence", () => {
  it("V8: every signal carries a numeric priority", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "decision_missing", message: "Decision missing" }],
        derived: { ...baseDerived, documentsReadinessPct: 30 },
      }),
      conditions: [
        { id: "c1", severity: "REQUIRED", status: "OPEN", title: "x" },
      ],
    });
    assert.ok(signals.length > 0);
    for (const s of signals) {
      assert.equal(typeof s.priority, "number");
      assert.equal(typeof s.rankReason, "string");
      assert.ok(s.rankReason.length > 0);
    }
  });

  it("V9: critical blocker ranks above readiness warning", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "deal_not_found", message: "Deal not found" }], // critical
        derived: { ...baseDerived, documentsReadinessPct: 30 }, // warning
      }),
    });
    const blocked = signals.find((s) => s.kind === "blocked_reason");
    const readiness = signals.find((s) => s.kind === "readiness_warning");
    assert.ok(blocked && readiness);
    assert.ok(
      blocked!.priority > readiness!.priority,
      "critical blocker priority must exceed readiness warning",
    );
  });

  it("V9: signals come back sorted by priority desc", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [
          { code: "decision_missing", message: "Decision missing" }, // warning blocker
        ],
        derived: { ...baseDerived, documentsReadinessPct: 30 }, // warning readiness
      }),
    });
    for (let i = 1; i < signals.length; i++) {
      assert.ok(
        signals[i - 1].priority >= signals[i].priority,
        `signals must be sorted: idx ${i - 1} has ${signals[i - 1].priority}, idx ${i} has ${signals[i].priority}`,
      );
    }
  });

  it("V10: failed recent mutation ranks above generic recent_change", () => {
    const now = 1_700_000_000_000;
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_action_succeeded", ts: now - 60_000, label: "Success" },
      { type: "cockpit_inline_mutation_failed", ts: now - 30_000, label: "Failed save" },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const recents = signals.filter((s) => s.kind === "recent_change");
    assert.ok(recents.length === 2);
    const failed = recents.find((s) => s.severity === "warning");
    const success = recents.find((s) => s.severity === "info");
    assert.ok(failed && success);
    assert.ok(
      failed!.priority > success!.priority,
      "failed recent mutation must rank above generic recent_change",
    );
  });

  it("V11: every signal carries a deterministic confidence in 0..1", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "decision_missing", message: "x" }],
        derived: { ...baseDerived, documentsReadinessPct: 30 },
      }),
    });
    for (const s of signals) {
      assert.equal(typeof s.confidence, "number");
      assert.ok(s.confidence > 0 && s.confidence <= 1);
    }
  });

  it("V12: lifecycle blocker confidence > telemetry confidence", () => {
    const now = 1_700_000_000_000;
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "decision_missing", message: "x" }],
      }),
      recentTelemetry: [
        { type: "cockpit_action_succeeded", ts: now - 60_000, label: "y" },
      ],
      now,
    });
    const blocker = signals.find((s) => s.source === "blockers");
    const telemetry = signals.find((s) => s.source === "telemetry");
    assert.ok(blocker && telemetry);
    assert.ok(
      blocker!.confidence > telemetry!.confidence,
      "blocker confidence must exceed telemetry confidence",
    );
  });
});

// ─── V13-V14: pure builder + CockpitAction shape ──────────────────

describe("SPEC-08 V13-V14 — purity preserved", () => {
  it("V13: builder is pure (no fetch / setTimeout / setInterval)", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setInterval\s*\(/.test(ADVISOR_BUILDER));
  });

  it("V14: advisor signals carry CockpitAction shape", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({ derived: { ...baseDerived, documentsReadinessPct: 30 } }),
    });
    const withAction = signals.find((s) => s.action);
    assert.ok(withAction);
    const intent = withAction!.action!.intent;
    assert.ok(
      intent === "navigate" || intent === "runnable" || intent === "fix_blocker",
    );
  });
});

// ─── V15-V18: reconcile coverage ──────────────────────────────────

describe("SPEC-08 V15-V18 — reconciliation coverage", () => {
  it("V15: /conditions/set-status returns canonical condition row", () => {
    assert.match(
      SET_STATUS_ROUTE,
      /\.select\([\s\S]+?id, deal_id, title, description, category, status/,
    );
    assert.match(SET_STATUS_ROUTE, /condition: up\.data/);
  });

  it("V15: ConditionsInlineEditor handleStatus reconciles from server row", () => {
    const idx = CONDITIONS_EDITOR.indexOf("function handleStatus");
    const next = CONDITIONS_EDITOR.indexOf("function handleSaveNote", idx);
    const slice = CONDITIONS_EDITOR.slice(idx, next);
    assert.match(slice, /reconcile:\s*\(serverJson:\s*\{\s*condition\?:/);
  });

  it("V16: /overrides/[id]/review returns canonical override row", () => {
    assert.match(REVIEW_ROUTE, /override: data/);
  });

  it("V16: OverrideInlineEditor mark-reviewed reconciles from server row", () => {
    const idx = OVERRIDE_EDITOR.indexOf("function handleMarkReviewed");
    const slice = OVERRIDE_EDITOR.slice(idx, idx + 4000);
    assert.match(slice, /reconcile:\s*\(serverJson:\s*\{\s*override\?:/);
  });

  it("V17/V18: useInlineMutation skips hard refresh when reconcile() returns true", () => {
    assert.match(USE_INLINE_MUTATION, /reconciled\s*=\s*opts\.reconcile\(serverJson\)/);
    assert.match(USE_INLINE_MUTATION, /if \(!reconciled\)/);
  });
});

// ─── V19-V20: condition row contract ───────────────────────────────

describe("SPEC-08 V19-V20 — condition row contract", () => {
  it("V19: /conditions and /conditions/list return same canonical key", () => {
    assert.match(CONDITIONS_ROUTE, /conditions:\s*data\s*\?\?\s*\[\]/);
    assert.match(CONDITIONS_LIST_ROUTE, /conditions,\s*items:\s*conditions/);
  });

  it("V19: shared DealConditionRow contract type exists", () => {
    assert.ok(CONTRACT_TYPES.includes("DealConditionRow"));
    assert.ok(CONTRACT_TYPES.includes('"open" | "satisfied" | "waived"'));
  });

  it("V20: ConditionsInlineEditor declares row type compatible with contract", () => {
    // The editor's local ConditionRow type must include id/title/status —
    // the canonical fields. (Full contract widening is a future cleanup.)
    assert.ok(CONDITIONS_EDITOR.includes("export type ConditionRow = {"));
    assert.ok(/id:\s*string/.test(CONDITIONS_EDITOR));
    assert.ok(/status\?:/.test(CONDITIONS_EDITOR));
  });

  it("DealConditionRow contract is importable and matches the type shape", () => {
    // Compile-time confirmation via type construction.
    const sample: DealConditionRow = {
      id: "x",
      deal_id: "d1",
      title: "t",
      description: null,
      category: null,
      status: "open",
      due_date: null,
    };
    assert.equal(sample.status, "open");
  });
});

// ─── V21-V24: telemetry refresh + undo visibility ─────────────────

describe("SPEC-08 V21-V24 — telemetry refresh + undo activity", () => {
  it("V21: telemetry hook auto-registers under stage data provider", () => {
    assert.match(TELEMETRY_HOOK, /registerRefresher\("all", "advisor:telemetry"/);
  });

  it("V22: registered refresher fires on stage refresh — non-blocking (void)", () => {
    assert.match(TELEMETRY_HOOK, /void refresh\(\)/);
  });

  it("V23: telemetry refresh failure does not throw (try/catch + setError)", () => {
    assert.match(TELEMETRY_HOOK, /catch \(err\)[\s\S]{0,200}setError/);
  });

  it("V24: undo events appear in recent_change when within window", () => {
    const now = 1_700_000_000_000;
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry: [
        { type: "cockpit_inline_mutation_undone", ts: now - 30_000, label: "Mark satisfied" },
      ],
      now,
    });
    const recents = signals.filter((s) => s.kind === "recent_change");
    assert.ok(recents.some((s) => s.title.toLowerCase().includes("undone")));
  });
});

// ─── V25-V28: preserved invariants ─────────────────────────────────

describe("SPEC-08 V25-V28 — invariants preserved", () => {
  it("V25: PrimaryActionBar still uses useCockpitAction", () => {
    const src = read(SHARED, "PrimaryActionBar.tsx");
    assert.ok(src.includes("useCockpitAction"));
  });

  it("V26: StageBlockerList still uses useCockpitAction", () => {
    const src = read(SHARED, "StageBlockerList.tsx");
    assert.ok(src.includes("useCockpitAction"));
  });

  it("V27: AdvancedDisclosure remains closed by default", () => {
    const src = read(SHARED, "AdvancedDisclosure.tsx");
    assert.ok(src.includes("<details"));
    assert.ok(!/<details[^>]*\bopen\b/.test(src));
  });

  it("V28: advisor panel passes test-supplied recentTelemetry through", () => {
    // Caller-supplied telemetry should bypass the live hook (enabled flag).
    assert.match(
      ADVISOR_PANEL,
      /recentTelemetry\s*=\s*props\.recentTelemetry\s*\?\?/,
    );
  });
});
