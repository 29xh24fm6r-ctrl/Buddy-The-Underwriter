import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildCockpitAdvisorSignals,
  type AdvisorBlockerObservationInput,
  type AdvisorTelemetryEvent,
  type CockpitAdvisorSignal,
} from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import { buildAdvisorMemorySummary } from "@/lib/journey/advisor/buildAdvisorMemorySummary";
import {
  signalKey,
  deriveEffectiveState,
  type AdvisorSignalFeedback,
} from "@/components/journey/stageViews/_shared/useAdvisorSignalFeedback";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { DealConditionRow } from "@/lib/journey/contracts/conditions";
import type { DealOverrideRow } from "@/lib/journey/contracts/overrides";
import { normalizeOverrideSeverity } from "@/lib/journey/contracts/overrides";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const LIB_JOURNEY = path.resolve(__dirname, "..", "..", "..", "lib", "journey");
const ROOT_API = path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const ADVISOR_BUILDER = read(LIB_JOURNEY, "advisor", "buildCockpitAdvisorSignals.ts");
const ADVISOR_PANEL = read(SHARED, "CockpitAdvisorPanel.tsx");
const FEEDBACK_HOOK = read(SHARED, "useAdvisorSignalFeedback.ts");
const CONDITIONS_EDITOR = read(STAGE_VIEWS, "conditions/ConditionsInlineEditor.tsx");
const OVERRIDE_EDITOR = read(STAGE_VIEWS, "decision/OverrideInlineEditor.tsx");
const CONTRACT_CONDITIONS = read(LIB_JOURNEY, "contracts/conditions.ts");
const CONTRACT_OVERRIDES = read(LIB_JOURNEY, "contracts/overrides.ts");
const CONDITIONS_LIST_ROUTE = read(ROOT_API, "conditions/list/route.ts");
const CONDITIONS_ROUTE = read(ROOT_API, "conditions/route.ts");
const OVERRIDES_ROUTE = read(ROOT_API, "overrides/route.ts");
const OVERRIDE_BY_ID_ROUTE = read(ROOT_API, "overrides/[overrideId]/route.ts");

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

// ─── V1: stable signal keys ───────────────────────────────────────

describe("SPEC-09 V1 — stable signal keys", () => {
  it("signalKey is stable across calls for the same deal+signal", () => {
    const signal: CockpitAdvisorSignal = {
      kind: "blocked_reason",
      severity: "warning",
      title: "Decision missing",
      detail: "x",
      source: "blockers",
      priority: 800,
      rankReason: "x",
      confidence: 0.95,
    };
    const k1 = signalKey("deal-1", signal);
    const k2 = signalKey("deal-1", signal);
    assert.equal(k1, k2);
    assert.notEqual(k1, signalKey("deal-2", signal));
  });

  it("includes dealId, kind, source, and title", () => {
    const signal: CockpitAdvisorSignal = {
      kind: "risk_warning",
      severity: "warning",
      title: "T",
      detail: "",
      source: "memo",
      priority: 0,
      rankReason: "",
      confidence: 0.85,
    };
    const k = signalKey("d1", signal);
    assert.match(k, /d1/);
    assert.match(k, /risk_warning/);
    assert.match(k, /memo/);
    assert.match(k, /T$/);
  });
});

// ─── V2-V6: feedback effective states + acknowledgment ────────────

describe("SPEC-09 V2-V6 — feedback effective states", () => {
  const baseSignal: CockpitAdvisorSignal = {
    kind: "risk_warning",
    severity: "warning",
    title: "Open conditions",
    detail: "x",
    source: "conditions",
    priority: 540,
    rankReason: "x",
    confidence: 0.85,
  };

  it("V2: dismissed feedback hides the signal", () => {
    const fb: AdvisorSignalFeedback = {
      signalKey: "k",
      dealId: "d1",
      state: "dismissed",
      createdAt: new Date().toISOString(),
    };
    const eff = deriveEffectiveState(fb, Date.now());
    assert.equal(eff.kind, "hidden_dismissed");
  });

  it("V3: snoozed (active) feedback hides the signal", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const fb: AdvisorSignalFeedback = {
      signalKey: "k",
      dealId: "d1",
      state: "snoozed",
      until: future,
      createdAt: new Date().toISOString(),
    };
    const eff = deriveEffectiveState(fb, Date.now());
    assert.equal(eff.kind, "hidden_snoozed");
  });

  it("V4: expired snooze surfaces as visible again", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const fb: AdvisorSignalFeedback = {
      signalKey: "k",
      dealId: "d1",
      state: "snoozed",
      until: past,
      createdAt: new Date().toISOString(),
    };
    const eff = deriveEffectiveState(fb, Date.now());
    assert.equal(eff.kind, "snooze_expired");
  });

  it("V5: acknowledged stays visible (separate state)", () => {
    const fb: AdvisorSignalFeedback = {
      signalKey: "k",
      dealId: "d1",
      state: "acknowledged",
      createdAt: new Date().toISOString(),
    };
    const eff = deriveEffectiveState(fb, Date.now());
    assert.equal(eff.kind, "acknowledged");
  });

  it("V6: panel applies -150 priority penalty when acknowledged", () => {
    // String search — ACK_PRIORITY_PENALTY is wired to 150 in the panel.
    assert.match(ADVISOR_PANEL, /ACK_PRIORITY_PENALTY\s*=\s*150/);
    assert.match(
      ADVISOR_PANEL,
      /priority:\s*signal\.priority\s*-\s*ACK_PRIORITY_PENALTY/,
    );
    void baseSignal;
  });
});

// ─── V7-V8: debug mode ────────────────────────────────────────────

describe("SPEC-09 V7-V8 — debug mode", () => {
  it("V7: panel renders priority/confidence/rankReason/source/signalKey when debug", () => {
    assert.match(ADVISOR_PANEL, /searchParams\?\.get\("advisor"\)\s*===\s*"debug"/);
    assert.match(ADVISOR_PANEL, /priority:\s*\{signal\.priority\}/);
    assert.match(ADVISOR_PANEL, /confidence:\s*\{signal\.confidence\}/);
    assert.match(ADVISOR_PANEL, /rankReason:\s*\{signal\.rankReason\}/);
    assert.match(ADVISOR_PANEL, /signalKey:\s*\{key\}/);
  });

  it("V8: debug section is conditional on URL flag", () => {
    assert.match(ADVISOR_PANEL, /\{debug\s*\?\s*\(/);
  });
});

// ─── V9-V12: grouped sections ─────────────────────────────────────

describe("SPEC-09 V9-V12 — grouped advisor sections", () => {
  it("V9: panel renders critical / needs_attention / suggested / recent / acknowledged", () => {
    assert.match(ADVISOR_PANEL, /"critical".*"needs_attention".*"suggested".*"recent".*"acknowledged"/s);
  });

  it("V10: classifySignal puts critical signals in `critical` group", () => {
    assert.match(ADVISOR_PANEL, /signal\.severity\s*===\s*"critical"\)\s*return\s*"critical"/);
  });

  it("V11: next_best_action goes to `suggested` group", () => {
    assert.match(ADVISOR_PANEL, /signal\.kind\s*===\s*"next_best_action"\)\s*return\s*"suggested"/);
  });

  it("V12: recent_change goes to `recent` group", () => {
    assert.match(ADVISOR_PANEL, /signal\.kind\s*===\s*"recent_change"\)\s*return\s*"recent"/);
  });
});

// ─── V13-V20: behavior pattern signals ────────────────────────────

describe("SPEC-09 V13-V20 — behavior pattern detection", () => {
  const now = 1_700_000_000_000;

  it("V13: repeated_action_failure emits behavior_pattern_warning", () => {
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_action_failed", ts: now - 10_000, label: "generate_packet" },
      { type: "cockpit_action_failed", ts: now - 20_000, label: "generate_packet" },
      { type: "cockpit_action_failed", ts: now - 30_000, label: "generate_packet" },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const pattern = signals.find((s) => s.kind === "behavior_pattern_warning");
    assert.ok(pattern, "should emit behavior_pattern_warning for repeated failures");
    assert.match(pattern!.title, /failed/i);
  });

  it("V14: repeated_inline_undo emits behavior_pattern_warning", () => {
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_inline_mutation_undone", ts: now - 10_000 },
      { type: "cockpit_inline_mutation_undone", ts: now - 20_000 },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const pattern = signals.find((s) => s.kind === "behavior_pattern_warning");
    assert.ok(pattern);
    assert.match(pattern!.title, /undone/i);
  });

  it("V15: stage_oscillation emits behavior_pattern_warning", () => {
    type T = AdvisorTelemetryEvent & { lifecycleStage?: string };
    const recentTelemetry: T[] = [
      { type: "cockpit_action_succeeded", ts: now - 60_000, lifecycleStage: "underwrite_ready" },
      { type: "cockpit_action_succeeded", ts: now - 50_000, lifecycleStage: "underwrite_in_progress" },
      { type: "cockpit_action_succeeded", ts: now - 40_000, lifecycleStage: "underwrite_ready" },
      { type: "cockpit_action_succeeded", ts: now - 30_000, lifecycleStage: "underwrite_in_progress" },
    ];
    // The summary builder is the source of truth; verify via memory builder.
    const summary = buildAdvisorMemorySummary({ recentTelemetry, now });
    assert.ok(
      summary.patterns.some((p) => p.kind === "stage_oscillation"),
      "stage_oscillation should be detected",
    );

    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const pattern = signals.find(
      (s) =>
        s.kind === "behavior_pattern_warning" &&
        s.title.toLowerCase().includes("oscillating"),
    );
    assert.ok(pattern);
  });

  it("V16: stale_blocker emits behavior_pattern_warning when first seen >24h ago", () => {
    const blockerObservations: AdvisorBlockerObservationInput[] = [
      {
        code: "decision_missing",
        firstSeenAt: new Date(now - 36 * 60 * 60_000).toISOString(),
      },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      blockerObservations,
      now,
    });
    const pattern = signals.find(
      (s) => s.kind === "behavior_pattern_warning" && s.title.includes("decision_missing"),
    );
    assert.ok(pattern);
  });

  it("V16: blocker first seen within 24h does NOT emit stale_blocker", () => {
    const blockerObservations: AdvisorBlockerObservationInput[] = [
      {
        code: "decision_missing",
        firstSeenAt: new Date(now - 60 * 60_000).toISOString(),
      },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      blockerObservations,
      now,
    });
    const stale = signals.find((s) => s.kind === "behavior_pattern_warning");
    assert.equal(stale, undefined);
  });

  it("V17: pattern warning priority exceeds generic recent_change", () => {
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_action_failed", ts: now - 10_000, label: "generate_packet" },
      { type: "cockpit_action_failed", ts: now - 20_000, label: "generate_packet" },
      { type: "cockpit_action_failed", ts: now - 30_000, label: "generate_packet" },
      { type: "cockpit_action_succeeded", ts: now - 40_000, label: "x" },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const pattern = signals.find((s) => s.kind === "behavior_pattern_warning");
    const recentChange = signals.find(
      (s) => s.kind === "recent_change" && s.severity !== "warning",
    );
    assert.ok(pattern);
    if (recentChange) {
      assert.ok(pattern!.priority > recentChange.priority);
    }
  });

  it("V18: pattern warning confidence is deterministic (telemetry source 0.75)", () => {
    const recentTelemetry: AdvisorTelemetryEvent[] = [
      { type: "cockpit_inline_mutation_undone", ts: now - 10_000 },
      { type: "cockpit_inline_mutation_undone", ts: now - 20_000 },
    ];
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry,
      now,
    });
    const pattern = signals.find((s) => s.kind === "behavior_pattern_warning");
    assert.equal(pattern!.confidence, 0.75);
  });

  it("V19: panel hides dismissed signals via deriveEffectiveState", () => {
    // The panel filters out "hidden_dismissed" signals.
    assert.match(
      ADVISOR_PANEL,
      /eff\.kind\s*===\s*"hidden_dismissed"\s*\|\|\s*eff\.kind\s*===\s*"hidden_snoozed"/,
    );
  });

  it("V20: classifySignal puts acknowledged signals into `acknowledged`", () => {
    assert.match(ADVISOR_PANEL, /isAcknowledged\)\s*return\s*"acknowledged"/);
  });
});

// ─── V21-V25: contract migrations ─────────────────────────────────

describe("SPEC-09 V21-V25 — contract migrations", () => {
  it("V21: ConditionsInlineEditor uses DealConditionRow contract", () => {
    assert.match(CONDITIONS_EDITOR, /DealConditionRow/);
    assert.match(CONDITIONS_EDITOR, /from "@\/lib\/journey\/contracts\/conditions"/);
  });

  it("V22: /conditions and /conditions/list return canonical-key shape", () => {
    assert.match(CONDITIONS_ROUTE, /conditions:\s*data\s*\?\?\s*\[\]/);
    assert.match(CONDITIONS_LIST_ROUTE, /conditions,\s*items:\s*conditions/);
  });

  it("V23: items alias still present, with deprecated comment", () => {
    assert.match(CONDITIONS_LIST_ROUTE, /deprecated alias/i);
  });

  it("V24: OverrideInlineEditor uses DealOverrideRow contract", () => {
    assert.match(OVERRIDE_EDITOR, /DealOverrideRow/);
    assert.match(OVERRIDE_EDITOR, /from "@\/lib\/journey\/contracts\/overrides"/);
  });

  it("V25: override endpoints select * (canonical row passthrough)", () => {
    assert.match(OVERRIDES_ROUTE, /\.select\("\*"\)/);
    assert.match(OVERRIDE_BY_ID_ROUTE, /\.select\("\*"\)/);
  });

  it("DealConditionRow type is importable and complete", () => {
    const row: DealConditionRow = {
      id: "c1",
      deal_id: "d1",
      title: "t",
      description: null,
      category: null,
      status: "open",
      due_date: null,
    };
    assert.equal(row.status, "open");
  });

  it("DealOverrideRow type is importable and complete", () => {
    const row: DealOverrideRow = {
      id: "o1",
      deal_id: "d1",
      decision_snapshot_id: null,
      field_path: "x",
      old_value: null,
      new_value: null,
      reason: "r",
      justification: null,
      severity: "warning",
      requires_review: true,
    };
    assert.equal(row.severity, "warning");
  });

  it("normalizeOverrideSeverity narrows known severities", () => {
    assert.equal(normalizeOverrideSeverity("warning"), "warning");
    assert.equal(normalizeOverrideSeverity("Critical"), "critical");
    assert.equal(normalizeOverrideSeverity("HIGH"), null);
    assert.equal(normalizeOverrideSeverity(null), null);
  });

  it("contract files exist", () => {
    assert.ok(CONTRACT_CONDITIONS.includes("DealConditionRow"));
    assert.ok(CONTRACT_OVERRIDES.includes("DealOverrideRow"));
  });
});

// ─── V26-V31: preserved invariants ────────────────────────────────

describe("SPEC-09 V26-V31 — invariants preserved", () => {
  it("V26: builder still pure (no fetch/setTimeout/setInterval)", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setInterval\s*\(/.test(ADVISOR_BUILDER));
  });

  it("V27: advisor signals carry CockpitAction shape", () => {
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

  it("V28: PrimaryActionBar still uses useCockpitAction", () => {
    const src = read(SHARED, "PrimaryActionBar.tsx");
    assert.ok(src.includes("useCockpitAction"));
  });

  it("V29: StageBlockerList still uses useCockpitAction", () => {
    const src = read(SHARED, "StageBlockerList.tsx");
    assert.ok(src.includes("useCockpitAction"));
  });

  it("V30: AdvancedDisclosure remains closed by default", () => {
    const src = read(SHARED, "AdvancedDisclosure.tsx");
    assert.ok(src.includes("<details"));
    assert.ok(!/<details[^>]*\bopen\b/.test(src));
  });

  it("V31: feedback hook persists to localStorage with versioned prefix", () => {
    assert.match(FEEDBACK_HOOK, /buddy\.advisor\.feedback\.v1\./);
  });
});
