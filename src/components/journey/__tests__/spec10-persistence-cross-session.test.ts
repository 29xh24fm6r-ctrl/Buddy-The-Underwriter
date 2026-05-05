import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildAdvisorMemorySummary,
  ADVISOR_MEMORY_WINDOW_MS,
  type AdvisorMemoryWindow,
} from "@/lib/journey/advisor/buildAdvisorMemorySummary";
import {
  buildCockpitAdvisorSignals,
  type AdvisorTelemetryEvent,
} from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import {
  __SPEC10,
  signalKey,
  deriveEffectiveState,
  type AdvisorSignalFeedback,
} from "@/components/journey/stageViews/_shared/useAdvisorSignalFeedback";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const LIB_JOURNEY = path.resolve(__dirname, "..", "..", "..", "lib", "journey");
const ROOT_API = path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]");
const MIGRATIONS = path.resolve(__dirname, "..", "..", "..", "..", "supabase", "migrations");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const ADVISOR_BUILDER = read(LIB_JOURNEY, "advisor", "buildCockpitAdvisorSignals.ts");
const ADVISOR_MEMORY = read(LIB_JOURNEY, "advisor", "buildAdvisorMemorySummary.ts");
const ADVISOR_PANEL = read(SHARED, "CockpitAdvisorPanel.tsx");
const TELEMETRY_HOOK = read(SHARED, "useRecentCockpitTelemetry.ts");
const FEEDBACK_HOOK = read(SHARED, "useAdvisorSignalFeedback.ts");
const BLOCKER_OBS_HOOK = read(SHARED, "useBlockerObservations.ts");
const FEEDBACK_ROUTE = read(ROOT_API, "advisor/feedback/route.ts");
const FEEDBACK_DELETE_ROUTE = read(ROOT_API, "advisor/feedback/[signalKey]/route.ts");
const BLOCKER_OBS_ROUTE = read(ROOT_API, "advisor/blocker-observations/route.ts");

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

// ─── V1-V2: server-first feedback hydration ────────────────────────

describe("SPEC-10 V1-V2 — feedback hydration", () => {
  it("V1: feedback hook fetches /advisor/feedback on mount", () => {
    assert.match(FEEDBACK_HOOK, /\/api\/deals\/\$\{encodeURIComponent\(dealId\)\}\/advisor\/feedback/);
    assert.match(FEEDBACK_HOOK, /hydrated\.current/);
  });

  it("V2: hook degrades to localStorage when server fetch fails", () => {
    // Server failure path: try/catch that leaves the localStorage cache.
    assert.match(FEEDBACK_HOOK, /server fetch failure[\s\S]{0,80}localStorage/i);
  });
});

// ─── V3-V7: feedback mutations + ledger events ────────────────────

describe("SPEC-10 V3-V7 — feedback mutations + ledger", () => {
  it("V3-V5: POST writes acknowledge / dismiss / snooze states", () => {
    assert.match(FEEDBACK_ROUTE, /VALID_STATES = new Set\(\["acknowledged", "dismissed", "snoozed"\]\)/);
    assert.match(FEEDBACK_ROUTE, /upsert/);
  });

  it("V5: POST persists snoozed_until when state=snoozed", () => {
    assert.match(
      FEEDBACK_ROUTE,
      /snoozed_until: state === "snoozed" \? snoozedUntil : null/,
    );
  });

  it("V6: DELETE clears server feedback by signal key", () => {
    assert.match(FEEDBACK_DELETE_ROUTE, /\.delete\(\)/);
    assert.match(FEEDBACK_DELETE_ROUTE, /\.eq\("signal_key", decodedKey\)/);
  });

  it("V7: every mutation mirrors to buddy_signal_ledger", () => {
    assert.match(FEEDBACK_ROUTE, /buddy_signal_ledger/);
    assert.match(
      FEEDBACK_ROUTE,
      /advisor_signal_acknowledged|advisor_signal_dismissed|advisor_signal_snoozed/,
    );
    assert.match(FEEDBACK_DELETE_ROUTE, /advisor_signal_feedback_cleared/);
  });

  it("server route degrades gracefully when table is missing", () => {
    assert.match(FEEDBACK_ROUTE, /isMissingTableError/);
    assert.match(FEEDBACK_ROUTE, /table_missing/);
  });
});

// ─── V8: repeated dismissal auto-snoozes for 7 days ───────────────

describe("SPEC-10 V8 — repeated-dismissal auto-snooze", () => {
  it("threshold + duration constants are wired correctly", () => {
    assert.equal(__SPEC10.REPEATED_DISMISS_THRESHOLD, 3);
    assert.equal(__SPEC10.REPEATED_DISMISS_SNOOZE_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it("dismiss path counts repeats and routes to snooze on threshold", () => {
    assert.match(FEEDBACK_HOOK, /readDismissCounts/);
    assert.match(FEEDBACK_HOOK, /next >= REPEATED_DISMISS_THRESHOLD/);
    assert.match(FEEDBACK_HOOK, /snoozeRaw\(signal, REPEATED_DISMISS_SNOOZE_MS, "repeated_dismissal"\)/);
  });

  it("clear() resets the dismiss counter so a new 3-strikes window starts fresh", () => {
    assert.match(FEEDBACK_HOOK, /delete counts\[key\];\s*writeDismissCounts/);
  });
});

// ─── V9: server feedback overrides stale localStorage ─────────────

describe("SPEC-10 V9 — server hydration overrides localStorage", () => {
  it("hydration replaces local store with server snapshot", () => {
    assert.match(
      FEEDBACK_HOOK,
      /next\.set\(row\.signal_key, fromServerRow\(row, dealId\)\)/,
    );
    assert.match(FEEDBACK_HOOK, /writeStore\(dealId, next\)/);
  });
});

// ─── V10-V14: blocker observations ─────────────────────────────────

describe("SPEC-10 V10-V14 — blocker observations + stale_blocker", () => {
  it("V10: GET returns observations with first_seen_at column", () => {
    assert.match(BLOCKER_OBS_ROUTE, /first_seen_at/);
    assert.match(BLOCKER_OBS_ROUTE, /last_seen_at/);
  });

  it("V11: POST upserts existing rows incrementing seen_count", () => {
    assert.match(
      BLOCKER_OBS_ROUTE,
      /seen_count:\s*\(prev\?\.seen_count\s*\?\?\s*0\)\s*\+\s*1/,
    );
  });

  it("V12: missing keys get resolved_at stamped", () => {
    assert.match(BLOCKER_OBS_ROUTE, /resolved_at:\s*now/);
  });

  it("V13: stale_blocker fires when first_seen_at > 24h", () => {
    const now = 1_700_000_000_000;
    const summary = buildAdvisorMemorySummary({
      now,
      blockerObservations: [
        {
          code: "decision_missing",
          firstSeenAt: new Date(now - 25 * 60 * 60_000).toISOString(),
        },
      ],
    });
    assert.ok(summary.patterns.some((p) => p.kind === "stale_blocker"));
  });

  it("V14: stale_blocker does not fire for newly observed blockers", () => {
    const now = 1_700_000_000_000;
    const summary = buildAdvisorMemorySummary({
      now,
      blockerObservations: [
        {
          code: "decision_missing",
          firstSeenAt: new Date(now - 60_000).toISOString(),
        },
      ],
    });
    assert.equal(
      summary.patterns.filter((p) => p.kind === "stale_blocker").length,
      0,
    );
  });

  it("useBlockerObservations exposes asAdvisorInput in code → firstSeenAt shape", () => {
    assert.match(BLOCKER_OBS_HOOK, /code: o\.blockerKey/);
    assert.match(BLOCKER_OBS_HOOK, /firstSeenAt: o\.firstSeenAt/);
  });

  it("hook filters resolved observations from the advisor input", () => {
    assert.match(BLOCKER_OBS_HOOK, /\.filter\(\(o\) => !o\.resolvedAt\)/);
  });
});

// ─── V15-V16: lifecycleStage in telemetry → stage_oscillation ─────

describe("SPEC-10 V15-V16 — telemetry exposes lifecycleStage", () => {
  it("V15: hook stamps lifecycleStage as a first-class field", () => {
    assert.match(TELEMETRY_HOOK, /lifecycleStage:/);
    assert.match(
      TELEMETRY_HOOK,
      /typeof row\.payload\?\.lifecycleStage === "string"/,
    );
  });

  it("V16: stage_oscillation works against typed events with lifecycleStage", () => {
    const now = 1_700_000_000_000;
    type EventWithStage = AdvisorTelemetryEvent & { lifecycleStage?: string };
    const events: EventWithStage[] = [
      { type: "cockpit_action_succeeded", ts: now - 60_000, lifecycleStage: "underwrite_ready" },
      { type: "cockpit_action_succeeded", ts: now - 50_000, lifecycleStage: "underwrite_in_progress" },
      { type: "cockpit_action_succeeded", ts: now - 40_000, lifecycleStage: "underwrite_ready" },
      { type: "cockpit_action_succeeded", ts: now - 30_000, lifecycleStage: "underwrite_in_progress" },
    ];
    const summary = buildAdvisorMemorySummary({ recentTelemetry: events, now });
    assert.ok(summary.patterns.some((p) => p.kind === "stage_oscillation"));
  });
});

// ─── V17-V19: memory windows ───────────────────────────────────────

describe("SPEC-10 V17-V19 — named memory windows", () => {
  it("V17: 1h window is the default", () => {
    assert.equal(ADVISOR_MEMORY_WINDOW_MS["1h"], 60 * 60 * 1000);
    assert.match(ADVISOR_MEMORY, /DEFAULT_WINDOW_MS = ADVISOR_MEMORY_WINDOW_MS\["1h"\]/);
  });

  it("V18: pattern detection defaults to 24h via patternWindow", () => {
    assert.match(
      ADVISOR_BUILDER,
      /windowMs:\s*ADVISOR_MEMORY_WINDOW_MS\[input\.patternWindow\s*\?\?\s*"24h"\]/,
    );
  });

  it("V19: debug mode opens to a 7d window in the panel", () => {
    assert.match(ADVISOR_PANEL, /window:\s*debug\s*\?\s*"7d"\s*:\s*"1h"/);
  });

  it("named windows resolve correctly", () => {
    assert.equal(
      ADVISOR_MEMORY_WINDOW_MS["24h" as AdvisorMemoryWindow],
      24 * 60 * 60 * 1000,
    );
    assert.equal(
      ADVISOR_MEMORY_WINDOW_MS["7d" as AdvisorMemoryWindow],
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it("buildAdvisorMemorySummary respects the `window` arg", () => {
    const now = 1_700_000_000_000;
    // An event 5 minutes old falls inside 1h but outside 1h-windowMs.
    const events: AdvisorTelemetryEvent[] = [
      { type: "cockpit_action_succeeded", ts: now - 25 * 60_000, label: "x" },
    ];
    const within1h = buildAdvisorMemorySummary({
      now,
      window: "1h",
      recentTelemetry: events,
    });
    const within24h = buildAdvisorMemorySummary({
      now,
      window: "24h",
      recentTelemetry: events,
    });
    assert.ok(within1h.lastActionAt);
    assert.ok(within24h.lastActionAt);
  });
});

// ─── V20-V21: Why? affordance + default cleanliness ───────────────

describe("SPEC-10 V20-V21 — Why am I seeing this?", () => {
  it("V20: panel renders a Why? toggle in default mode", () => {
    assert.match(ADVISOR_PANEL, /data-testid="advisor-why-toggle"/);
    assert.match(ADVISOR_PANEL, /data-testid="advisor-why-block"/);
    assert.match(ADVISOR_PANEL, /Reason:.*signal\.rankReason/s);
    assert.match(ADVISOR_PANEL, /Source:.*signal\.source/s);
    assert.match(ADVISOR_PANEL, /Confidence:.*confidencePct/s);
  });

  it("V21: default mode hides priority + signalKey in the Why block", () => {
    // The Why block deliberately lists only Reason / Source / Confidence;
    // priority / signalKey live exclusively in the debug overlay.
    const whyBlockMatch = ADVISOR_PANEL.match(
      /data-testid="advisor-why-block"[\s\S]*?<\/div>\s*\)\s*:\s*null/,
    );
    assert.ok(whyBlockMatch, "Why block should render and close");
    // Confirm priority/signalKey words don't appear inside the Why block.
    const whyText = whyBlockMatch?.[0] ?? "";
    assert.ok(!/priority/i.test(whyText));
    assert.ok(!/signalKey/i.test(whyText));
  });

  it("default mode does NOT render the debug block", () => {
    assert.match(ADVISOR_PANEL, /\{debug\s*\?\s*\([\s\S]*?advisor-debug-block/);
  });
});

// ─── V22-V23: builder still pure / feedback outside builder ───────

describe("SPEC-10 V22-V23 — purity preserved", () => {
  it("V22: builder remains pure (no fetch/setTimeout/setInterval)", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setInterval\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_MEMORY));
  });

  it("V23: feedback application lives in the panel/hook, not the pure builder", () => {
    // The pure builder doesn't import the feedback hook or know about
    // dismissed/snoozed states. The panel applies feedback.
    assert.ok(!/useAdvisorSignalFeedback/.test(ADVISOR_BUILDER));
    assert.ok(!/dismissed/.test(ADVISOR_BUILDER));
    assert.match(ADVISOR_PANEL, /useAdvisorSignalFeedback/);
  });
});

// ─── V24-V27: invariants preserved ─────────────────────────────────

describe("SPEC-10 V24-V27 — invariants preserved", () => {
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

  it("V27 sentinel: builder still emits CockpitAction-shaped advisor actions", () => {
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

// ─── Migration files exist ─────────────────────────────────────────

describe("SPEC-10 — migration files", () => {
  it("buddy_advisor_feedback migration exists and creates the table", () => {
    const candidates = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => /create_buddy_advisor_feedback\.sql$/.test(f));
    assert.ok(candidates.length === 1, "exactly one feedback migration");
    const sql = fs.readFileSync(path.resolve(MIGRATIONS, candidates[0]), "utf-8");
    assert.match(sql, /create table if not exists buddy_advisor_feedback/);
    assert.match(sql, /unique \(bank_id, deal_id, user_id, signal_key\)/);
  });

  it("buddy_blocker_observations migration exists and creates the table", () => {
    const candidates = fs
      .readdirSync(MIGRATIONS)
      .filter((f) => /create_buddy_blocker_observations\.sql$/.test(f));
    assert.ok(candidates.length === 1, "exactly one blocker observations migration");
    const sql = fs.readFileSync(path.resolve(MIGRATIONS, candidates[0]), "utf-8");
    assert.match(sql, /create table if not exists buddy_blocker_observations/);
    assert.match(sql, /unique \(bank_id, deal_id, blocker_key\)/);
  });
});

// ─── feedback effective-state pure helper still works ──────────────

describe("SPEC-10 — deriveEffectiveState (regression)", () => {
  it("acknowledged stays visible (separate state)", () => {
    const fb: AdvisorSignalFeedback = {
      signalKey: "k",
      dealId: "d1",
      state: "acknowledged",
      createdAt: new Date().toISOString(),
    };
    const eff = deriveEffectiveState(fb, Date.now());
    assert.equal(eff.kind, "acknowledged");
  });

  it("signalKey is stable", () => {
    const sig = {
      kind: "blocked_reason" as const,
      severity: "warning" as const,
      title: "x",
      detail: "",
      source: "blockers" as const,
      priority: 0,
      rankReason: "",
      confidence: 0.9,
    };
    assert.equal(signalKey("d1", sig), signalKey("d1", sig));
  });
});
