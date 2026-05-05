import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildCockpitAdvisorSignals } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import type { LifecycleState } from "@/buddy/lifecycle/model";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const LIB_JOURNEY = path.resolve(__dirname, "..", "..", "..", "lib", "journey");
const ROOT_API = path.resolve(__dirname, "..", "..", "..", "app", "api", "deals", "[dealId]");
const MIGRATIONS = path.resolve(__dirname, "..", "..", "..", "..", "supabase", "migrations");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const ADVISOR_BUILDER = read(LIB_JOURNEY, "advisor", "buildCockpitAdvisorSignals.ts");
const ADVISOR_PANEL = read(SHARED, "CockpitAdvisorPanel.tsx");
const FEEDBACK_HOOK = read(SHARED, "useAdvisorSignalFeedback.ts");
const BLOCKER_OBS_HOOK = read(SHARED, "useBlockerObservations.ts");
const FEEDBACK_ROUTE = read(ROOT_API, "advisor/feedback/route.ts");
const FEEDBACK_DELETE_ROUTE = read(ROOT_API, "advisor/feedback/[signalKey]/route.ts");
const RLS_MIGRATION = (() => {
  const candidates = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => /add_rls_and_dismiss_counts_to_advisor_tables\.sql$/.test(f));
  assert.equal(candidates.length, 1, "exactly one RLS migration");
  return read(MIGRATIONS, candidates[0]);
})();

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

// ─── V1-V4: RLS on persistence tables ─────────────────────────────

describe("SPEC-11 V1-V4 — RLS on advisor persistence", () => {
  it("V1: buddy_advisor_feedback enables RLS", () => {
    assert.match(
      RLS_MIGRATION,
      /alter table buddy_advisor_feedback enable row level security/i,
    );
  });

  it("V2: buddy_blocker_observations enables RLS", () => {
    assert.match(
      RLS_MIGRATION,
      /alter table buddy_blocker_observations enable row level security/i,
    );
  });

  it("V3: feedback policies restrict by bank_id via get_current_bank_id()", () => {
    // SELECT/INSERT/UPDATE/DELETE policies all anchor on
    // bank_id = public.get_current_bank_id().
    const matches = (RLS_MIGRATION.match(
      /buddy_advisor_feedback[\s\S]*?bank_id\s*=\s*public\.get_current_bank_id\(\)/g,
    ) ?? []).length;
    assert.ok(matches >= 4, "feedback table should declare 4+ bank_id policy clauses");
  });

  it("V4: blocker observation policies restrict by bank_id", () => {
    const matches = (RLS_MIGRATION.match(
      /buddy_blocker_observations[\s\S]*?bank_id\s*=\s*public\.get_current_bank_id\(\)/g,
    ) ?? []).length;
    assert.ok(matches >= 4);
  });
});

// ─── V5-V6: server-side snooze filtering ──────────────────────────

describe("SPEC-11 V5-V6 — server-side snooze filtering", () => {
  it("V5: GET excludes expired snoozes", () => {
    assert.match(
      FEEDBACK_ROUTE,
      /state !== "snoozed"[\s\S]{0,80}snoozed_until/,
    );
    assert.match(FEEDBACK_ROUTE, /new Date\(row\.snoozed_until\)\.getTime\(\) > now/);
  });

  it("V6: client doesn't have to filter — server already did", () => {
    // The server returns only active rows; the panel passes them through
    // deriveEffectiveState which still handles edge cases (e.g. a snooze
    // expiring between server-render and client-render).
    assert.match(FEEDBACK_ROUTE, /\.filter\(\(row: any\) => \{/);
    assert.match(FEEDBACK_ROUTE, /feedback: active/);
  });
});

// ─── V7-V10: server-side dismiss count + auto-snooze + clear ──────

describe("SPEC-11 V7-V10 — server-side dismiss tracking", () => {
  it("V7: POST increments dismiss_count when state=dismissed", () => {
    assert.match(FEEDBACK_ROUTE, /wasDismissed = state === "dismissed"/);
    assert.match(
      FEEDBACK_ROUTE,
      /newDismissCount = wasDismissed[\s\S]{0,80}dismiss_count\s*\?\?\s*0\)\s*\+\s*1/,
    );
  });

  it("V8: dismiss_count >= 3 auto-snoozes for 7 days", () => {
    assert.match(
      FEEDBACK_ROUTE,
      /REPEATED_DISMISS_THRESHOLD = 3/,
    );
    assert.match(
      FEEDBACK_ROUTE,
      /REPEATED_DISMISS_SNOOZE_MS = 7 \* 24 \* 60 \* 60 \* 1000/,
    );
    assert.match(
      FEEDBACK_ROUTE,
      /resolvedReason = "repeated_dismissal"/,
    );
  });

  it("V9: client hook no longer maintains a browser dismiss counter", () => {
    // SPEC-10's localStorage dismiss-count cache is removed in SPEC-11.
    // The hook still has the helper functions defined but they are no
    // longer called from `dismiss()`; the client posts and reconciles
    // from the server response.
    assert.match(FEEDBACK_HOOK, /persistServerAndReconcile/);
    assert.ok(
      !/snoozeRaw\(signal, REPEATED_DISMISS_SNOOZE_MS, "repeated_dismissal"\)/.test(
        FEEDBACK_HOOK,
      ),
      "browser-only auto-snooze path must be removed",
    );
  });

  it("V10: clearing feedback removes the row server-side (taking dismiss_count with it)", () => {
    assert.match(FEEDBACK_DELETE_ROUTE, /\.delete\(\)/);
    assert.match(FEEDBACK_DELETE_ROUTE, /\.eq\("signal_key", decodedKey\)/);
  });

  it("ledger event tags autoSnoozedFromDismissal flag", () => {
    assert.match(FEEDBACK_ROUTE, /autoSnoozedFromDismissal/);
  });
});

// ─── V11-V13: blocker observations debounced + deduped ────────────

describe("SPEC-11 V11-V13 — debounced + deduped observations", () => {
  it("V11: useBlockerObservations debounces with 250ms setTimeout", () => {
    assert.match(BLOCKER_OBS_HOOK, /setTimeout\(\(\) => \{[\s\S]{0,60}void post\(\)/);
    assert.match(BLOCKER_OBS_HOOK, /250/);
  });

  it("V12: identical sorted blocker keys are deduped (lastPostedKey ref)", () => {
    assert.match(BLOCKER_OBS_HOOK, /lastPostedKey\.current === blockerKey/);
    assert.match(
      BLOCKER_OBS_HOOK,
      /blockers\.map\(\(b\) => b\.code\)\.sort\(\)\.join\("\|"\)/,
    );
  });

  it("V13: hook still feeds the resolved-blocker filter", () => {
    assert.match(BLOCKER_OBS_HOOK, /\.filter\(\(o\) => !o\.resolvedAt\)/);
  });
});

// ─── V14-V15: low_signal_value detector ───────────────────────────

describe("SPEC-11 V14-V15 — low_signal_value", () => {
  it("V14: emits low_signal_value when dismiss count >= 3", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      dismissCountsBySignalKey: { "d1|risk_warning|memo|x": 4 },
    });
    const low = signals.find((s) => s.kind === "low_signal_value");
    assert.ok(low, "low_signal_value should emit");
    assert.match(low!.title, /Repeatedly dismissed/);
  });

  it("V14: emits low_signal_value for stale acknowledgements (>24h)", () => {
    const now = 1_700_000_000_000;
    const oldAck = new Date(now - 26 * 60 * 60_000).toISOString();
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      acknowledgedAtBySignalKey: { "d1|risk_warning|memo|x": oldAck },
      now,
    });
    const low = signals.find((s) => s.kind === "low_signal_value");
    assert.ok(low);
    assert.match(low!.title, /Acknowledged 24h\+ ago/);
  });

  it("V15: low_signal_value priority is the lowest tier (floor 100)", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "decision_missing", message: "x" }],
      }),
      dismissCountsBySignalKey: { "d1|some-key|memo|y": 3 },
    });
    const blocker = signals.find((s) => s.kind === "blocked_reason");
    const low = signals.find((s) => s.kind === "low_signal_value");
    assert.ok(blocker && low);
    assert.ok(low!.priority < blocker!.priority);
    // Low signal floor is 100; severity=info bumps zero, so priority ≈ 100.
    assert.ok(low!.priority < 200, "low_signal_value should sit below recent_change");
  });

  it("low_signal_value confidence is deterministic (telemetry source 0.75)", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      dismissCountsBySignalKey: { "d1|x|y|z": 5 },
    });
    const low = signals.find((s) => s.kind === "low_signal_value");
    assert.equal(low!.confidence, 0.75);
  });
});

// ─── V16-V21: predictive_warning ──────────────────────────────────

describe("SPEC-11 V16-V21 — predictive_warning", () => {
  it("V16: likely_committee_delay emits when packet not ready and gaps exist", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
        },
      }),
      memoSummary: { missing_keys: ["A", "B"], present_keys: [], required_keys: ["A", "B"] },
    });
    const pred = signals.find(
      (s) => s.kind === "predictive_warning" && s.predictionReason === "likely_committee_delay",
    );
    assert.ok(pred, "should emit likely_committee_delay");
  });

  it("V16: does NOT emit likely_committee_delay when packet is ready", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: true,
        },
      }),
      memoSummary: { missing_keys: ["A"], present_keys: [], required_keys: ["A"] },
    });
    const pred = signals.find(
      (s) => s.predictionReason === "likely_committee_delay",
    );
    assert.equal(pred, undefined);
  });

  it("V17: missing_required_condition emits in closing with open conditions", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({ stage: "closing_in_progress" }),
      conditions: [
        { id: "c1", severity: "REQUIRED", status: "OPEN", title: "Title insurance" },
      ],
    });
    const pred = signals.find(
      (s) => s.predictionReason === "missing_required_condition",
    );
    assert.ok(pred);
  });

  it("V17: does NOT emit missing_required_condition outside closing stage", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({ stage: "underwrite_ready" }),
      conditions: [{ id: "c1", severity: "REQUIRED", status: "OPEN", title: "x" }],
    });
    const pred = signals.find(
      (s) => s.predictionReason === "missing_required_condition",
    );
    assert.equal(pred, undefined);
  });

  it("V18: high_risk_override_cluster emits for unresolved >= 3", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      overrides: [
        { id: "1", requires_review: true },
        { id: "2", requires_review: true },
        { id: "3", requires_review: true },
      ],
    });
    const pred = signals.find(
      (s) => s.predictionReason === "high_risk_override_cluster",
    );
    assert.ok(pred);
  });

  it("V18: high_risk_override_cluster emits for >= 1 critical override", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      overrides: [{ id: "1", severity: "CRITICAL" }],
    });
    const pred = signals.find(
      (s) => s.predictionReason === "high_risk_override_cluster",
    );
    assert.ok(pred);
    assert.equal(pred!.severity, "critical");
  });

  it("V19: predictive_warning signals carry predictionReason", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      overrides: [
        { id: "1", requires_review: true },
        { id: "2", requires_review: true },
        { id: "3", requires_review: true },
      ],
    });
    const pred = signals.find((s) => s.kind === "predictive_warning");
    assert.ok(pred);
    assert.equal(typeof pred!.predictionReason, "string");
  });

  it("V20: predictive signals are pure — builder still does not fetch", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_BUILDER));
  });

  it("V21: predictive_warning ranks below critical blockers, above generic recent_change", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "deal_not_found", message: "x" }],
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
        },
      }),
      memoSummary: { missing_keys: ["A"], present_keys: [], required_keys: ["A"] },
      recentTelemetry: [
        {
          type: "cockpit_action_succeeded",
          ts: (1_700_000_000_000 - 60_000),
          label: "x",
        },
      ],
      now: 1_700_000_000_000,
    });
    const blocker = signals.find((s) => s.kind === "blocked_reason");
    const pred = signals.find((s) => s.kind === "predictive_warning");
    const recent = signals.find((s) => s.kind === "recent_change");
    assert.ok(blocker && pred && recent);
    assert.ok(blocker!.priority > pred!.priority);
    assert.ok(pred!.priority > recent!.priority);
  });
});

// ─── V22-V23: debug overlay shows extras; default hides them ──────

describe("SPEC-11 V22-V23 — debug overlay", () => {
  it("V22: debug block shows dismiss_count and predictionReason", () => {
    assert.match(ADVISOR_PANEL, /dismiss_count:\s*\{dismissCount\}/);
    assert.match(
      ADVISOR_PANEL,
      /signal\.predictionReason \?[\s\S]{0,200}predictionReason:/,
    );
  });

  it("V23: default mode hides dismiss_count and predictionReason", () => {
    // The Why? block shows only Reason / Source / Confidence — not
    // dismiss_count or predictionReason.
    const whyBlock = ADVISOR_PANEL.match(
      /data-testid="advisor-why-block"[\s\S]*?<\/div>\s*\)\s*:\s*null/,
    );
    assert.ok(whyBlock);
    const whyText = whyBlock![0];
    assert.ok(!/dismiss_count/.test(whyText));
    assert.ok(!/predictionReason/.test(whyText));
  });
});

// ─── V24-V27: invariants preserved ────────────────────────────────

describe("SPEC-11 V24-V27 — invariants preserved", () => {
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

// ─── Migration shape check ────────────────────────────────────────

describe("SPEC-11 — migration shape", () => {
  it("adds dismiss_count + last_dismissed_at columns", () => {
    assert.match(
      RLS_MIGRATION,
      /add column if not exists dismiss_count integer not null default 0/,
    );
    assert.match(
      RLS_MIGRATION,
      /add column if not exists last_dismissed_at timestamptz/,
    );
  });

  it("creates index for dismiss_count threshold reads", () => {
    assert.match(
      RLS_MIGRATION,
      /create index if not exists idx_buddy_advisor_feedback_dismiss_count/,
    );
  });
});
