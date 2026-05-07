// Pure orchestrator for the Committee Anticipation Engine.
//
// Composes the per-domain rule modules, ranks objections by severity +
// domain priority, computes posture grade, and synthesizes a positioning
// recommendation the banker can quote walking into committee.

import type {
  CommitteeAnticipationReport,
  CommitteeEngineInputs,
  CommitteeObjection,
  CommitteePosture,
  PositioningRecommendation,
} from "./types";
import { repaymentRules } from "./rules/repaymentRules";
import { leverageRules } from "./rules/leverageRules";
import { liquidityRules } from "./rules/liquidityRules";
import { collateralRules } from "./rules/collateralRules";
import { concentrationRules } from "./rules/concentrationRules";
import { documentationRules } from "./rules/documentationRules";
import {
  policyRules,
  structuralRules,
} from "./rules/policyAndStructuralRules";
import { industryRules } from "./rules/industryRules";

const DOMAIN_PRIORITY: Record<CommitteeObjection["domain"], number> = {
  documentation: 0, // gating — banker must fix before submission
  repayment: 1,
  leverage: 2,
  liquidity: 3,
  collateral: 4,
  policy: 5,
  guarantor: 6,
  structural: 7,
  concentration: 8,
  industry: 9,
};

const SEVERITY_PRIORITY: Record<CommitteeObjection["severity"], number> = {
  hard: 0,
  soft: 1,
  info: 2,
};

export function evaluateCommitteeAnticipation(
  inputs: CommitteeEngineInputs,
): CommitteeAnticipationReport {
  const now = inputs.now ?? new Date();

  // 1. Gather objections from every rule module.
  const all: CommitteeObjection[] = [
    ...repaymentRules(inputs),
    ...leverageRules(inputs),
    ...liquidityRules(inputs),
    ...collateralRules(inputs),
    ...concentrationRules(inputs),
    ...documentationRules(inputs),
    ...policyRules(inputs),
    ...structuralRules(inputs),
    ...industryRules(inputs),
  ];

  // 2. Sort: severity asc, then domain priority asc, then label.
  all.sort((a, b) => {
    const s = SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
    if (s !== 0) return s;
    const d = DOMAIN_PRIORITY[a.domain] - DOMAIN_PRIORITY[b.domain];
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });

  // 3. Split documentation (gating) from substantive committee objections so
  //    the rail surfaces them in two distinct buckets.
  const doc_weaknesses = all.filter((o) => o.domain === "documentation");
  const objections = all.filter((o) => o.domain !== "documentation");

  // 4. Posture grade.
  const posture = derivePosture({ inputs, objections, doc_weaknesses });

  // 5. Confidence score (informally — posture indicator only).
  const confidence_score = computeConfidenceScore({ posture, objections, doc_weaknesses });

  // 6. Positioning recommendation.
  const positioning = derivePositioning({ inputs, objections });

  // 7. Follow-up question prompts derived from objections.
  const follow_ups = deriveFollowUps(objections);

  // 8. Headline — one-liner the banker can quote.
  const headline = deriveHeadline({ posture, objections, doc_weaknesses });

  return {
    deal_id: inputs.dealId,
    posture,
    confidence_score,
    objections,
    doc_weaknesses,
    follow_ups,
    positioning,
    headline,
    evaluatedAt: now.toISOString(),
    contractVersion: "committee_anticipation_v1",
  };
}

// ─── Posture grade ───────────────────────────────────────────────────────────

function derivePosture(args: {
  inputs: CommitteeEngineInputs;
  objections: CommitteeObjection[];
  doc_weaknesses: CommitteeObjection[];
}): CommitteePosture {
  // If memo inputs aren't ready, the deal isn't even submittable.
  if (!args.inputs.memoInput.ready || args.doc_weaknesses.length > 0) {
    return "not_ready";
  }
  const hardCount = args.objections.filter((o) => o.severity === "hard").length;
  if (hardCount === 0) return "committee_ready";
  if (hardCount <= 2) return "workable_with_mitigants";
  return "hard_sell";
}

// ─── Confidence score ────────────────────────────────────────────────────────

function computeConfidenceScore(args: {
  posture: CommitteePosture;
  objections: CommitteeObjection[];
  doc_weaknesses: CommitteeObjection[];
}): number {
  // 100 = clean. Each hard objection deducts 15; each soft 5; each doc
  // weakness 10. Floor at 0.
  let score = 100;
  for (const o of args.objections) {
    score -= o.severity === "hard" ? 15 : o.severity === "soft" ? 5 : 1;
  }
  score -= args.doc_weaknesses.length * 10;
  if (args.posture === "not_ready") score = Math.min(score, 50);
  return Math.max(0, Math.min(100, score));
}

// ─── Positioning recommendation ──────────────────────────────────────────────

function derivePositioning(args: {
  inputs: CommitteeEngineInputs;
  objections: CommitteeObjection[];
}): PositioningRecommendation {
  const lead_with: string[] = [];
  const prepare_for: string[] = [];
  const m = args.inputs.metrics;

  // Lead-with strengths.
  if (m.dscr !== null && m.dscr >= 1.4) {
    lead_with.push(
      `Open with the ${m.dscr.toFixed(2)}x DSCR — coverage is the strongest point in the file.`,
    );
  }
  if (m.collateral_coverage !== null && m.collateral_coverage >= 1.5) {
    lead_with.push(
      `Lean on collateral coverage of ${m.collateral_coverage.toFixed(2)}x — well above the 1.25x committee comfort line.`,
    );
  }
  const recurring = /(recurring|subscription|contracted|saas)/i.test(
    args.inputs.memoInput.borrowerStoryRevenueModel ?? "",
  );
  if (recurring) {
    lead_with.push(
      "Frame the borrower as a recurring-revenue business — emphasize contract length and renewal economics.",
    );
  }
  if (
    args.inputs.memoInput.managementProfilesCount > 0 &&
    args.inputs.memoInput.collateralWithValueCount > 0
  ) {
    if (lead_with.length === 0) {
      lead_with.push(
        "Lead with operating performance and collateral coverage — the deal stands on the standard committee pillars.",
      );
    }
  }
  if (lead_with.length === 0) {
    lead_with.push(
      "Lead with the cleanest part of the file — point to the strongest metric and the most defensible collateral.",
    );
  }

  // Prepare-for: each hard objection turns into an explicit prep line.
  const hardObjs = args.objections.filter((o) => o.severity === "hard");
  for (const o of hardObjs.slice(0, 3)) {
    prepare_for.push(
      o.mitigant
        ? `${o.label} — counter: ${o.mitigant}`
        : `${o.label} — be ready to address the rationale.`,
    );
  }
  // Always add a follow-up on documentation if any soft objections exist.
  const softObjs = args.objections.filter((o) => o.severity === "soft");
  if (prepare_for.length < 3 && softObjs.length > 0) {
    prepare_for.push(
      `Likely soft challenge: ${softObjs[0].label} — ${softObjs[0].rationale}`,
    );
  }

  const frame = chooseFrame(args.inputs, hardObjs);

  return {
    lead_with: lead_with.slice(0, 3),
    prepare_for: prepare_for.slice(0, 3),
    frame,
  };
}

function chooseFrame(
  inputs: CommitteeEngineInputs,
  hardObjs: CommitteeObjection[],
): string | undefined {
  const m = inputs.metrics;
  // Strong coverage + collateral → "stable cash flow + collateral cushion"
  if (
    (m.dscr ?? 0) >= 1.5 &&
    (m.collateral_coverage ?? 0) >= 1.5 &&
    hardObjs.length === 0
  ) {
    return "Frame: well-covered cash flow protected by a collateral cushion.";
  }
  if (hardObjs.some((o) => o.domain === "leverage")) {
    return "Frame: acknowledge leverage upfront, then pivot to deleveraging path and sponsor support.";
  }
  if (hardObjs.some((o) => o.domain === "collateral")) {
    return "Frame: cash-flow-first credit — position collateral as secondary repayment, not primary.";
  }
  if (hardObjs.some((o) => o.domain === "liquidity")) {
    return "Frame: emphasize operating cash flow stability to offset modest sponsor liquidity.";
  }
  return undefined;
}

// ─── Follow-up questions ─────────────────────────────────────────────────────

function deriveFollowUps(objections: CommitteeObjection[]): string[] {
  const out: string[] = [];
  for (const o of objections) {
    if (o.severity === "hard") {
      out.push(`How are we addressing: ${o.label}?`);
    }
  }
  // Add a closing question.
  if (out.length === 0) {
    out.push("Any concentrations or trends the committee should be aware of?");
  }
  return out.slice(0, 5);
}

// ─── Headline ───────────────────────────────────────────────────────────────

function deriveHeadline(args: {
  posture: CommitteePosture;
  objections: CommitteeObjection[];
  doc_weaknesses: CommitteeObjection[];
}): string {
  switch (args.posture) {
    case "committee_ready":
      return "This deal is committee-ready.";
    case "workable_with_mitigants": {
      const top = args.objections.find((o) => o.severity === "hard");
      return top
        ? `Workable with mitigants — lead concern: ${top.label}.`
        : "Workable with mitigants.";
    }
    case "hard_sell": {
      const hardCount = args.objections.filter((o) => o.severity === "hard").length;
      return `Hard sell — ${hardCount} material concern${hardCount === 1 ? "" : "s"}; restructure recommended before submission.`;
    }
    case "not_ready":
      return `Not ready for committee — ${args.doc_weaknesses.length} input gap${args.doc_weaknesses.length === 1 ? "" : "s"} must be resolved first.`;
  }
}
