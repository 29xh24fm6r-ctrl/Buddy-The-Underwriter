/**
 * SPEC-12 — pure decision-quality signal builder.
 *
 * Emits deterministic `decision_quality_warning` signals from a snapshot
 * of decision/override/memo/lifecycle inputs. The four checks are
 * intentionally narrow — each cites the specific risk and points at the
 * remediation surface. No fetch, no I/O, no time-of-day branching.
 *
 * Predictors:
 *   - approval_without_conditions  — risky approve with no conditions
 *   - override_without_rationale   — override missing reason+justification
 *   - memo_mismatch_risk           — memo gaps in committee/decision stage
 *   - attestation_gap              — decision present but attestation off
 */
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { CockpitAction } from "@/components/journey/actions/actionTypes";
import type { AdvisorEvidence } from "./evidence";

export type DecisionQualitySignal = {
  predictionReason:
    | "approval_without_conditions"
    | "override_without_rationale"
    | "memo_mismatch_risk"
    | "attestation_gap";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  evidence: AdvisorEvidence[];
  action?: CockpitAction;
  /** Source attribution for the panel grouping. */
  source: "decision" | "overrides" | "memo" | "conditions";
};

export type DecisionQualityConditionRow = {
  id: string;
  status?: string | null;
  severity?: string | null;
};

export type DecisionQualityOverrideRow = {
  id: string;
  reason?: string | null;
  justification?: string | null;
  severity?: string | null;
  requires_review?: boolean;
};

export type DecisionQualityDecision = {
  /** Free-form decision string ("approved", "approve_with_conditions", "declined", ...). */
  decision?: string | null;
  status?: string | null;
};

export type DecisionQualityMemoSummary = {
  required_keys?: string[];
  present_keys?: string[];
  missing_keys?: string[];
};

export type BuildDecisionQualitySignalsInput = {
  state: LifecycleState | null;
  decision?: DecisionQualityDecision | null;
  conditions?: DecisionQualityConditionRow[];
  overrides?: DecisionQualityOverrideRow[];
  memoSummary?: DecisionQualityMemoSummary | null;
  dealId: string;
};

const APPROVAL_TOKENS = ["approve", "approved"];

const COMMITTEE_OR_DECISION_STAGES: ReadonlySet<string> = new Set([
  "committee_ready",
  "committee_decisioned",
]);

function isOpenCondition(c: DecisionQualityConditionRow): boolean {
  const status = (c.status ?? "OPEN").toUpperCase();
  return !["COMPLETE", "CLEARED", "SATISFIED", "WAIVED"].includes(status);
}

function looksApproved(decision: DecisionQualityDecision | null | undefined): boolean {
  if (!decision) return false;
  const tokens = [decision.decision, decision.status]
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase());
  return tokens.some((tok) =>
    APPROVAL_TOKENS.some(
      (probe) => tok === probe || tok.startsWith(`${probe}_`) || tok.includes(probe),
    ),
  );
}

export function buildDecisionQualitySignals(
  input: BuildDecisionQualitySignalsInput,
): DecisionQualitySignal[] {
  const out: DecisionQualitySignal[] = [];
  const state = input.state;
  if (!state) return out;

  // 1) approval_without_conditions
  // approved decision AND no approval conditions AND risk/override warnings exist.
  const approved = looksApproved(input.decision);
  const conditions = input.conditions ?? [];
  const overrides = input.overrides ?? [];
  const memoMissing = input.memoSummary?.missing_keys?.length ?? 0;
  const reviewableOverrides = overrides.filter(
    (o) => o.requires_review === true,
  );
  const criticalOverrides = overrides.filter(
    (o) =>
      (o.severity ?? "").toUpperCase() === "CRITICAL" ||
      (o.severity ?? "").toUpperCase() === "HIGH",
  );

  if (approved && conditions.length === 0) {
    const hasRisk =
      reviewableOverrides.length > 0 ||
      criticalOverrides.length > 0 ||
      memoMissing > 0;
    if (hasRisk) {
      const evidence: AdvisorEvidence[] = [
        { source: "decision", label: "Decision", value: input.decision?.decision ?? "approved" },
        { source: "conditions", label: "Approval conditions", value: 0, severity: "warning" },
      ];
      if (reviewableOverrides.length > 0) {
        evidence.push({
          source: "overrides",
          label: "Open overrides",
          value: reviewableOverrides.length,
          severity: "warning",
        });
      }
      if (criticalOverrides.length > 0) {
        evidence.push({
          source: "overrides",
          label: "Critical overrides",
          value: criticalOverrides.length,
          severity: "critical",
        });
      }
      if (memoMissing > 0) {
        evidence.push({
          source: "memo",
          label: "Memo gaps",
          value: memoMissing,
          severity: "warning",
        });
      }
      out.push({
        predictionReason: "approval_without_conditions",
        severity: criticalOverrides.length > 0 ? "critical" : "warning",
        title: "Approval has no recorded conditions",
        detail:
          "An approve decision is on the deal but no approval conditions are recorded — and risk signals are still open.",
        evidence,
        source: "decision",
        action: {
          intent: "navigate",
          label: "Open Decision",
          href: `/deals/${input.dealId}/decision`,
        },
      });
    }
  }

  // 2) override_without_rationale
  // override exists AND reason/justification missing.
  const orphanedOverrides = overrides.filter(
    (o) =>
      (o.reason == null || o.reason.trim() === "") &&
      (o.justification == null || o.justification.trim() === ""),
  );
  if (orphanedOverrides.length > 0) {
    out.push({
      predictionReason: "override_without_rationale",
      severity: orphanedOverrides.length >= 3 ? "critical" : "warning",
      title: `${orphanedOverrides.length} override${orphanedOverrides.length === 1 ? "" : "s"} missing rationale`,
      detail:
        "Overrides without a reason or justification are unsafe to ship to committee.",
      evidence: [
        {
          source: "overrides",
          label: "Overrides without reason or justification",
          value: orphanedOverrides.length,
          severity: orphanedOverrides.length >= 3 ? "critical" : "warning",
        },
      ],
      source: "overrides",
      action: {
        intent: "navigate",
        label: "Open Overrides",
        href: `/deals/${input.dealId}/decision/overrides`,
      },
    });
  }

  // 3) memo_mismatch_risk
  // memo gaps > 0 AND committee/decision stage.
  if (
    memoMissing > 0 &&
    COMMITTEE_OR_DECISION_STAGES.has(String(state.stage))
  ) {
    out.push({
      predictionReason: "memo_mismatch_risk",
      severity: memoMissing >= 5 ? "critical" : "warning",
      title: `Memo missing ${memoMissing} canonical fact${memoMissing === 1 ? "" : "s"}`,
      detail:
        "Decision/committee stage is unsafe with unresolved memo gaps. Reconcile before locking.",
      evidence: [
        { source: "lifecycle", label: "Stage", value: String(state.stage) },
        {
          source: "memo",
          label: "Missing canonical facts",
          value: memoMissing,
          severity: memoMissing >= 5 ? "critical" : "warning",
        },
      ],
      source: "memo",
      action: {
        intent: "navigate",
        label: "Open Memo",
        href: `/deals/${input.dealId}/credit-memo`,
      },
    });
  }

  // 4) attestation_gap
  // decision made AND attestationSatisfied = false.
  const decisionPresent = state.derived.decisionPresent === true;
  const attestationSatisfied = state.derived.attestationSatisfied === true;
  if (decisionPresent && !attestationSatisfied) {
    out.push({
      predictionReason: "attestation_gap",
      severity: "critical",
      title: "Decision present but attestation incomplete",
      detail:
        "A decision exists but attestation has not been satisfied — required before release.",
      evidence: [
        { source: "decision", label: "Decision present", value: true },
        {
          source: "lifecycle",
          label: "Attestation satisfied",
          value: false,
          severity: "critical",
        },
      ],
      source: "decision",
      action: {
        intent: "navigate",
        label: "Open Decision",
        href: `/deals/${input.dealId}/decision`,
      },
    });
  }

  return out;
}
