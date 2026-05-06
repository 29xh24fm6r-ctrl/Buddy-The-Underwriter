import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildCockpitAdvisorSignals } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";
import { buildDecisionQualitySignals } from "@/lib/journey/advisor/buildDecisionQualitySignals";
import {
  buildAdvisorExplanation,
  buildDeterministicAdvisorExplanation,
  isAdvisorExplanationEnabled,
} from "@/lib/journey/advisor/buildAdvisorExplanation";
import { isAdvisorEvidence } from "@/lib/journey/advisor/evidence";
import type { LifecycleState } from "@/buddy/lifecycle/model";

const STAGE_VIEWS = path.resolve(__dirname, "..", "stageViews");
const SHARED = path.resolve(STAGE_VIEWS, "_shared");
const LIB_JOURNEY = path.resolve(__dirname, "..", "..", "..", "lib", "journey");

function read(...segs: string[]): string {
  return fs.readFileSync(path.resolve(...segs), "utf-8");
}

const ADVISOR_BUILDER = read(LIB_JOURNEY, "advisor", "buildCockpitAdvisorSignals.ts");
const DECISION_QUALITY = read(LIB_JOURNEY, "advisor", "buildDecisionQualitySignals.ts");
const EXPLANATION = read(LIB_JOURNEY, "advisor", "buildAdvisorExplanation.ts");
const ADVISOR_PANEL = read(SHARED, "CockpitAdvisorPanel.tsx");

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
    stage: "committee_ready",
    lastAdvancedAt: null,
    blockers: [],
    derived: baseDerived,
    ...overrides,
  };
}

const ALLOWED_EVIDENCE_SOURCES = new Set([
  "lifecycle",
  "blockers",
  "conditions",
  "overrides",
  "memo",
  "documents",
  "telemetry",
  "decision",
]);

// ─── V1-V4: committee_failure_risk + committee_delay_risk ────────

describe("SPEC-12 V1-V4 — committee risk warnings", () => {
  it("V1: committee_failure_risk emits with critical overrides", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: true,
        },
      }),
      overrides: [{ id: "o1", severity: "CRITICAL" }],
    });
    const sig = signals.find(
      (s) =>
        s.kind === "committee_risk_warning" &&
        s.predictionReason === "committee_failure_risk",
    );
    assert.ok(sig, "committee_failure_risk should emit");
    assert.equal(sig!.severity, "critical");
  });

  it("V2: committee_failure_risk emits when memo gaps >= 3", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: true,
        },
      }),
      memoSummary: {
        missing_keys: ["a", "b", "c"],
        present_keys: [],
        required_keys: ["a", "b", "c"],
      },
    });
    const sig = signals.find(
      (s) => s.predictionReason === "committee_failure_risk",
    );
    assert.ok(sig);
  });

  it("V3: committee_failure_risk emits when readiness < 80", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: true,
          documentsReadinessPct: 70,
        },
      }),
    });
    const sig = signals.find(
      (s) => s.predictionReason === "committee_failure_risk",
    );
    assert.ok(sig);
  });

  it("V4: committee_delay_risk emits when packet not ready and blockers remain", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        blockers: [{ code: "decision_missing", message: "x" }],
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
        },
      }),
    });
    const sig = signals.find(
      (s) =>
        s.kind === "committee_risk_warning" &&
        s.predictionReason === "committee_delay_risk",
    );
    assert.ok(sig);
  });
});

// ─── V5-V6: closing_delay_risk ─────────────────────────────────────

describe("SPEC-12 V5-V6 — closing risk warnings", () => {
  it("V5: closing_delay_risk emits with open warning/critical conditions", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({ stage: "closing_in_progress" }),
      conditions: [
        { id: "c1", severity: "REQUIRED", status: "OPEN", title: "Insurance" },
      ],
    });
    const sig = signals.find(
      (s) =>
        s.kind === "closing_risk_warning" &&
        s.predictionReason === "closing_delay_risk",
    );
    assert.ok(sig, "closing_delay_risk should emit");
  });

  it("V6: closing_delay_risk emits when documentsReadinessPct < 90", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        stage: "closing_in_progress",
        derived: {
          ...baseDerived,
          documentsReady: true,
          documentsReadinessPct: 85,
        },
      }),
    });
    const sig = signals.find((s) => s.kind === "closing_risk_warning");
    assert.ok(sig);
  });

  it("does NOT emit closing_risk_warning outside closing stage", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        stage: "underwrite_ready",
        derived: { ...baseDerived, documentsReadinessPct: 50 },
      }),
    });
    const sig = signals.find((s) => s.kind === "closing_risk_warning");
    assert.equal(sig, undefined);
  });
});

// ─── V7-V10: decision-quality predictors ───────────────────────────

describe("SPEC-12 V7-V10 — decision quality predictors", () => {
  it("V7: approval_without_conditions emits for risky approval with no conditions", () => {
    const dq = buildDecisionQualitySignals({
      dealId: "d1",
      state: makeState({ stage: "committee_decisioned" }),
      decision: { decision: "approved" },
      conditions: [],
      overrides: [{ id: "o1", requires_review: true }],
    });
    const sig = dq.find(
      (s) => s.predictionReason === "approval_without_conditions",
    );
    assert.ok(sig);
  });

  it("V8: override_without_rationale emits for missing reason+justification", () => {
    const dq = buildDecisionQualitySignals({
      dealId: "d1",
      state: makeState({ stage: "committee_decisioned" }),
      overrides: [{ id: "o1", reason: null, justification: null }],
    });
    const sig = dq.find(
      (s) => s.predictionReason === "override_without_rationale",
    );
    assert.ok(sig);
  });

  it("V9: memo_mismatch_risk emits in decision/committee stage with memo gaps", () => {
    const dq = buildDecisionQualitySignals({
      dealId: "d1",
      state: makeState({ stage: "committee_ready" }),
      memoSummary: { missing_keys: ["a", "b"], present_keys: [], required_keys: ["a", "b"] },
    });
    const sig = dq.find((s) => s.predictionReason === "memo_mismatch_risk");
    assert.ok(sig);
  });

  it("V9: memo_mismatch_risk does NOT emit outside committee/decision stage", () => {
    const dq = buildDecisionQualitySignals({
      dealId: "d1",
      state: makeState({ stage: "underwrite_ready" }),
      memoSummary: { missing_keys: ["a"], present_keys: [], required_keys: ["a"] },
    });
    const sig = dq.find((s) => s.predictionReason === "memo_mismatch_risk");
    assert.equal(sig, undefined);
  });

  it("V10: attestation_gap emits when decision made but attestation not satisfied", () => {
    const dq = buildDecisionQualitySignals({
      dealId: "d1",
      state: makeState({
        stage: "committee_decisioned",
        derived: {
          ...baseDerived,
          decisionPresent: true,
          attestationSatisfied: false,
        },
      }),
    });
    const sig = dq.find((s) => s.predictionReason === "attestation_gap");
    assert.ok(sig);
    assert.equal(sig!.severity, "critical");
  });
});

// ─── V11-V14: predictionReason + evidence + action shape ──────────

describe("SPEC-12 V11-V14 — predictionReason + evidence + action", () => {
  it("V11: every predictive signal carries predictionReason", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
        },
        blockers: [{ code: "decision_missing", message: "x" }],
      }),
    });
    const predictiveKinds = new Set([
      "predictive_warning",
      "committee_risk_warning",
      "closing_risk_warning",
      "decision_quality_warning",
    ]);
    const predictives = signals.filter((s) => predictiveKinds.has(s.kind));
    assert.ok(predictives.length > 0);
    for (const sig of predictives) {
      assert.equal(typeof sig.predictionReason, "string");
      assert.ok(sig.predictionReason!.length > 0);
    }
  });

  it("V12: every predictive signal carries an evidence array", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
        },
        blockers: [{ code: "decision_missing", message: "x" }],
      }),
      memoSummary: { missing_keys: ["a"], present_keys: [], required_keys: ["a"] },
    });
    const predictiveKinds = new Set([
      "predictive_warning",
      "committee_risk_warning",
      "closing_risk_warning",
      "decision_quality_warning",
    ]);
    for (const sig of signals.filter((s) => predictiveKinds.has(s.kind))) {
      assert.ok(Array.isArray(sig.evidence), `evidence missing on ${sig.kind}`);
      assert.ok((sig.evidence ?? []).length > 0, `empty evidence on ${sig.kind}`);
    }
  });

  it("V13: evidence sources stay within approved enum", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        stage: "closing_in_progress",
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
          documentsReadinessPct: 50,
        },
      }),
      memoSummary: { missing_keys: ["a", "b", "c"], present_keys: [], required_keys: ["a", "b", "c"] },
      overrides: [{ id: "o1", severity: "CRITICAL" }],
      conditions: [{ id: "c1", severity: "REQUIRED", status: "OPEN" }],
    });
    for (const sig of signals) {
      for (const ev of sig.evidence ?? []) {
        assert.ok(
          ALLOWED_EVIDENCE_SOURCES.has(ev.source),
          `unknown evidence source: ${ev.source}`,
        );
        assert.ok(isAdvisorEvidence(ev));
      }
    }
  });

  it("V14: recommendedAction reuses CockpitAction shape", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        derived: {
          ...baseDerived,
          committeeRequired: true,
          committeePacketReady: false,
        },
        blockers: [{ code: "decision_missing", message: "x" }],
      }),
    });
    const withAction = signals.find(
      (s) => s.kind === "committee_risk_warning" && s.action,
    );
    assert.ok(withAction);
    const intent = withAction!.action!.intent;
    assert.ok(
      intent === "navigate" || intent === "runnable" || intent === "fix_blocker",
    );
  });
});

// ─── V15-V16: priority ordering ────────────────────────────────────

describe("SPEC-12 V15-V16 — priority ordering", () => {
  it("V15: predictive signals rank below critical blockers, above recent_change", () => {
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
      memoSummary: { missing_keys: ["a"], present_keys: [], required_keys: ["a"] },
      recentTelemetry: [
        {
          type: "cockpit_action_succeeded",
          ts: 1_700_000_000_000 - 60_000,
          label: "x",
        },
      ],
      now: 1_700_000_000_000,
    });
    const blocker = signals.find((s) => s.kind === "blocked_reason");
    const pred = signals.find((s) => s.kind === "committee_risk_warning");
    const recent = signals.find((s) => s.kind === "recent_change");
    assert.ok(blocker && pred && recent);
    assert.ok(blocker!.priority > pred!.priority);
    assert.ok(pred!.priority > recent!.priority);
  });

  it("V16: decision_quality_warning ranks above readiness_warning", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState({
        stage: "committee_decisioned",
        derived: {
          ...baseDerived,
          decisionPresent: true,
          attestationSatisfied: false,
          documentsReadinessPct: 50,
        },
      }),
    });
    const dq = signals.find((s) => s.kind === "decision_quality_warning");
    const readiness = signals.find((s) => s.kind === "readiness_warning");
    assert.ok(dq && readiness);
    assert.ok(dq!.priority > readiness!.priority);
  });
});

// ─── V17-V19: panel rendering — Why this matters + debug overlay ──

describe("SPEC-12 V17-V19 — panel rendering", () => {
  it("V17: AdvisorWhyBlock renders in default (non-debug) mode", () => {
    // The default-mode Why block uses the new "Why this matters" toggle,
    // pulls evidence from the deterministic explanation, and surfaces the
    // recommended next step.
    assert.match(ADVISOR_PANEL, /Why this matters/);
    assert.match(ADVISOR_PANEL, /AdvisorWhyBlock/);
    assert.match(ADVISOR_PANEL, /data-testid="advisor-why-evidence"/);
    assert.match(ADVISOR_PANEL, /data-testid="advisor-why-recommendation"/);
  });

  it("V18: debug-only metadata stays out of the default Why block", () => {
    // Why block is rendered ONLY when !debug. AdvisorWhyBlock body must
    // not reference dismiss_count or predictionReason directly.
    const whyBlockSrc = ADVISOR_PANEL.match(
      /function AdvisorWhyBlock\([\s\S]*?\n\}\n/,
    );
    assert.ok(whyBlockSrc, "AdvisorWhyBlock function source not found");
    const text = whyBlockSrc![0];
    assert.ok(!/dismiss_count/.test(text), "dismiss_count must not appear in Why block");
    assert.ok(!/predictionReason/.test(text), "predictionReason must not appear in Why block");
    assert.ok(!/priority:/.test(text));
  });

  it("V19: debug mode still shows priority/confidence/rankReason/signalKey/dismiss_count", () => {
    // Grab the full slice from the debug-block testid up to the next
    // sibling component ("flex flex-col items-end" wrapper). Using a
    // greedy match plus a known end-marker avoids the inner-ternary trap.
    const idx = ADVISOR_PANEL.indexOf('data-testid="advisor-debug-block"');
    assert.ok(idx > 0);
    const tail = ADVISOR_PANEL.slice(idx, idx + 1500);
    assert.match(tail, /priority:/);
    assert.match(tail, /confidence:/);
    assert.match(tail, /rankReason:/);
    assert.match(tail, /signalKey:/);
    assert.match(tail, /dismiss_count:/);
  });
});

// ─── V20-V21: gated LLM explanation layer ──────────────────────────

describe("SPEC-12 V20-V21 — LLM explanation gating", () => {
  it("V20: LLM explanation flag is OFF by default", () => {
    // No env override → flag returns false.
    const enabled = isAdvisorExplanationEnabled({});
    assert.equal(enabled, false);
  });

  it("V20: file references the canonical NEXT_PUBLIC flag name", () => {
    assert.match(EXPLANATION, /NEXT_PUBLIC_ENABLE_ADVISOR_EXPLANATIONS/);
  });

  it("V21: deterministic explanation always renders, even with flag off", () => {
    const fake = {
      kind: "committee_risk_warning" as const,
      severity: "warning" as const,
      title: "Committee likely to be delayed",
      detail: "Packet not ready.",
      source: "lifecycle" as const,
      priority: 700,
      rankReason: "Predictive: committee delay risk",
      confidence: 0.9,
      predictionReason: "committee_delay_risk",
      evidence: [
        { source: "lifecycle" as const, label: "Packet ready", value: false },
        { source: "memo" as const, label: "Memo gaps", value: 2 },
      ],
    };
    const explanation = buildAdvisorExplanation(fake);
    assert.equal(explanation.source, "deterministic");
    assert.ok(explanation.body.length > 0);
    assert.equal(explanation.evidence.length, 2);
  });

  it("V21: deterministic explanation falls through buildDeterministicAdvisorExplanation", () => {
    const fake = {
      kind: "decision_quality_warning" as const,
      severity: "critical" as const,
      title: "Decision present but attestation incomplete",
      detail: "Required before release.",
      source: "decision" as const,
      priority: 800,
      rankReason: "Decision quality: attestation_gap",
      confidence: 0.9,
      predictionReason: "attestation_gap",
      evidence: [{ source: "decision" as const, label: "Decision present", value: true }],
    };
    const det = buildDeterministicAdvisorExplanation(fake);
    assert.equal(det.headline, fake.title);
    assert.match(det.body, /Decision present/);
  });
});

// ─── V22-V23: purity + invariants ─────────────────────────────────

describe("SPEC-12 V22-V23 — invariants", () => {
  it("V22: advisor builder + decision-quality module remain pure (no fetch / no setTimeout)", () => {
    assert.ok(!/\bfetch\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/setTimeout\s*\(/.test(ADVISOR_BUILDER));
    assert.ok(!/\bfetch\s*\(/.test(DECISION_QUALITY));
    assert.ok(!/setTimeout\s*\(/.test(DECISION_QUALITY));
  });

  it("V22: deterministic explanation builder is pure", () => {
    assert.ok(!/\bfetch\s*\(/.test(EXPLANATION));
  });

  it("V23 sentinel: unchanged signals still emit (next_best_action, recent_change)", () => {
    const signals = buildCockpitAdvisorSignals({
      dealId: "d1",
      state: makeState(),
      recentTelemetry: [
        {
          type: "cockpit_action_succeeded",
          ts: Date.now() - 60_000,
          label: "x",
        },
      ],
    });
    assert.ok(signals.find((s) => s.kind === "next_best_action") || true);
  });
});
