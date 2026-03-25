/**
 * Generate or refresh canonical credit memo from frozen state.
 * Uses frozen builder state, exceptions, mitigants, and selected scenario.
 * Pure module — no DB, no server-only.
 */

import { generatePolicyNarrative, type PolicyNarrativeInput } from "./generatePolicyNarrative";
import { generateCommitteeExceptionNarrative, type ExceptionRecord, type ExceptionAction } from "./generateCommitteeExceptionNarrative";
import { generateRecommendationNarrative } from "./generateRecommendationNarrative";
import type { StructuringScenario, PathToApprovalPlan } from "@/lib/structuring/types";
import { buildPathToApprovalPlan } from "@/lib/structuring/buildPathToApprovalPlan";

export type MemoAlignmentState = "aligned" | "stale" | "missing";

export type FreezeBasedMemoInput = {
  frozenBuilderState: Record<string, unknown>;
  frozenExceptions: ExceptionRecord[];
  frozenExceptionActions: ExceptionAction[];
  frozenMitigants: string[];
  selectedScenario: StructuringScenario | null;
  allScenarios: StructuringScenario[];

  // For policy narrative
  policyNarrativeInput?: PolicyNarrativeInput | null;
};

export type GeneratedMemoSections = {
  transaction_summary: string;
  borrower_summary: string;
  management_story: string;
  collateral_analysis: string;
  policy_exception_analysis: string;
  mitigants: string;
  recommendation_summary: string;
  approval_considerations: string;
};

/**
 * Generate credit memo sections from frozen state.
 */
export function generateMemoFromFreeze(
  input: FreezeBasedMemoInput,
): GeneratedMemoSections {
  const dealSection = (input.frozenBuilderState as any)?.deal ?? {};
  const businessSection = (input.frozenBuilderState as any)?.business ?? {};
  const partiesSection = (input.frozenBuilderState as any)?.parties ?? {};
  const storySection = (input.frozenBuilderState as any)?.story ?? {};

  // Transaction summary
  const txnParts: string[] = [];
  if (businessSection.legal_entity_name) {
    txnParts.push(`${businessSection.legal_entity_name}`);
    if (businessSection.dba) txnParts[0] += ` (DBA: ${businessSection.dba})`;
  }
  if (dealSection.requested_amount) {
    txnParts.push(`is requesting a $${Number(dealSection.requested_amount).toLocaleString()} ${dealSection.loan_type ?? "loan"}.`);
  }
  if (dealSection.loan_purpose) {
    txnParts.push(`Purpose: ${dealSection.loan_purpose}.`);
  }

  // Borrower / ownership
  const owners = partiesSection.owners ?? [];
  const ownerLines = owners.map((o: any) =>
    `${o.full_legal_name ?? "Unknown"}${o.ownership_pct != null ? ` (${o.ownership_pct}%)` : ""}${o.title ? ` — ${o.title}` : ""}`,
  );
  const borrowerSummary = ownerLines.length > 0
    ? `Ownership: ${ownerLines.join("; ")}.`
    : "Ownership information not yet documented.";

  // Management / story
  const storyParts: string[] = [];
  if (storySection.management_qualifications) storyParts.push(storySection.management_qualifications);
  if (storySection.competitive_position) storyParts.push(storySection.competitive_position);
  if (storySection.deal_strengths) storyParts.push(`Strengths: ${storySection.deal_strengths}`);
  if (storySection.known_weaknesses) storyParts.push(`Risks: ${storySection.known_weaknesses}`);

  // Policy narrative
  let collateralAnalysis = "Collateral analysis not yet available.";
  if (input.policyNarrativeInput) {
    const policyNarrative = generatePolicyNarrative(input.policyNarrativeInput);
    collateralAnalysis = policyNarrative.collateral_analysis;
  }

  // Exception narrative
  const exceptionNarrative = generateCommitteeExceptionNarrative(
    input.frozenExceptions,
    input.frozenExceptionActions,
  );

  // Recommendation narrative
  const plan = input.selectedScenario ? buildPathToApprovalPlan(input.selectedScenario) : null;
  const recNarrative = generateRecommendationNarrative(
    input.selectedScenario,
    input.allScenarios,
    plan,
  );

  // Mitigants
  const mitigantsText = input.frozenMitigants.length > 0
    ? `Compensating factors: ${input.frozenMitigants.join(" ")}`
    : exceptionNarrative.mitigants_summary;

  // Approval considerations
  const approvalParts: string[] = [];
  approvalParts.push(exceptionNarrative.recommendation_support);
  if (recNarrative.path_to_approval) {
    approvalParts.push(recNarrative.path_to_approval);
  }

  return {
    transaction_summary: txnParts.join(" ") || "Transaction summary not yet available.",
    borrower_summary: borrowerSummary,
    management_story: storyParts.join(" ") || "Management and story information not yet documented.",
    collateral_analysis: collateralAnalysis,
    policy_exception_analysis: exceptionNarrative.exception_register_summary +
      (exceptionNarrative.key_exception_narratives.length > 0
        ? " " + exceptionNarrative.key_exception_narratives.map((n) => n.narrative).join(" ")
        : ""),
    mitigants: mitigantsText,
    recommendation_summary: recNarrative.recommended_structure,
    approval_considerations: approvalParts.join(" "),
  };
}

/**
 * Determine memo alignment state.
 */
export function computeMemoAlignment(args: {
  activeMemoSnapshotId: string | null;
  activeFreezeId: string | null;
  memoFreezeId: string | null;
}): MemoAlignmentState {
  if (!args.activeMemoSnapshotId) return "missing";
  if (!args.activeFreezeId) return "missing";
  if (args.memoFreezeId !== args.activeFreezeId) return "stale";
  return "aligned";
}
