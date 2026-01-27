/**
 * Guided Examiner Walkthrough (Phase K)
 *
 * Provides a step-by-step examination flow for regulatory examiners.
 * Each step includes inline explanations, links to playbooks,
 * hash verification helpers, and what to look for.
 *
 * Invariants:
 *  - Content is static and deterministic
 *  - No marketing or promotional language
 *  - Every step references specific artifacts
 *  - Regulator tone throughout
 */

export type WalkthroughStep = {
  step_number: number;
  title: string;
  description: string;
  what_to_verify: string[];
  artifacts_to_review: string[];
  playbook_reference: string;
  verification_action: string | null;
};

export type ExaminerWalkthrough = {
  walkthrough_version: "1.0";
  generated_at: string;
  total_steps: number;
  steps: WalkthroughStep[];
};

/**
 * Generate the complete examiner walkthrough.
 * All content is static — no DB or AI calls.
 */
export function generateExaminerWalkthrough(): ExaminerWalkthrough {
  return {
    walkthrough_version: "1.0",
    generated_at: new Date().toISOString(),
    total_steps: WALKTHROUGH_STEPS.length,
    steps: WALKTHROUGH_STEPS,
  };
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    step_number: 1,
    title: "System Overview & AI Governance",
    description:
      "Begin by reviewing the system architecture and AI governance framework. " +
      "Confirm that all AI models operate in assistive-only mode with no " +
      "autonomous decision authority. Verify the model registry is complete " +
      "and all models have declared input/output boundaries.",
    what_to_verify: [
      "All 4 AI models are listed in the governance appendix",
      "Every model has decision_authority: assistive-only",
      "Every model has human_override_required: true",
      "No model has access to borrower funds or accounts",
      "Governance invariant check passes (invariant_check.ok === true)",
    ],
    artifacts_to_review: [
      "policies/model-governance.json",
      "playbooks/examiner-playbooks.json → system_overview",
      "playbooks/examiner-playbooks.json → ai_usage_explanation",
    ],
    playbook_reference: "System Overview + AI Usage Explanation",
    verification_action: "Run invariant check: verify governance_appendix.invariant_check.ok === true",
  },
  {
    step_number: 2,
    title: "Borrower Identity & Verification",
    description:
      "Review how borrower identity is established, verified, and attested. " +
      "Confirm that EIN handling follows masking rules (full EIN never stored " +
      "in model outputs). Verify ownership extraction sources and attestation " +
      "requirements.",
    what_to_verify: [
      "Borrower legal name matches tax return documents",
      "EIN is masked to **-***NNNN format in all outputs",
      "Entity type is correctly identified (1120/1065/1120S/1040)",
      "Ownership percentages sum to <= 100%",
      "Owners >= 20% are tracked for regulatory purposes",
      "Human attestation was completed before underwriting proceeded",
    ],
    artifacts_to_review: [
      "borrower-audit/snapshot.json",
      "borrower-audit/snapshot.pdf",
    ],
    playbook_reference: "Borrower Verification",
    verification_action: "Compare borrower-audit/snapshot.json fields against uploaded tax returns",
  },
  {
    step_number: 3,
    title: "Financial Analysis & Data Integrity",
    description:
      "Examine the financial metrics used for underwriting. Verify that " +
      "DSCR, LTV, NOI, and collateral coverage are correctly computed. " +
      "Check that conflicting data sources are resolved by priority " +
      "(Manual > Spread > Extract), not by AI preference.",
    what_to_verify: [
      "DSCR calculation is supported by income and debt service figures",
      "LTV is computed from appraised value and loan amount",
      "NOI matches rent roll or income statement data",
      "Financial completeness percentage reflects data availability",
      "Source provenance shows where each metric originated",
      "Stress scenarios use declared parameters, not AI assumptions",
    ],
    artifacts_to_review: [
      "financials/financial-snapshot.json",
      "credit-decision/snapshot.json → financials section",
    ],
    playbook_reference: "Credit Decision Process → Risk Grading",
    verification_action: "Verify DSCR = NOI / Annual Debt Service from financial-snapshot.json",
  },
  {
    step_number: 4,
    title: "Policy Evaluation & Rule Application",
    description:
      "Review how bank credit policy was applied to this deal. Confirm " +
      "that policy rules are evaluated programmatically (deterministic), " +
      "not by AI. Check that policy exceptions are documented and approved.",
    what_to_verify: [
      "Policy rules evaluated count matches bank policy configuration",
      "Hard rule failures are accompanied by exceptions or overrides",
      "Soft rule warnings have documented mitigants or justification",
      "Policy chunks used for context are from the correct bank",
      "No AI-generated policy rules exist (rules are bank-configured)",
    ],
    artifacts_to_review: [
      "policies/policy-eval.json",
      "policies/exceptions.json",
      "credit-decision/snapshot.json → policy section",
    ],
    playbook_reference: "Credit Decision Process → Policy Application",
    verification_action: "Confirm policy-eval rules_evaluated >= rules_passed + rules_failed",
  },
  {
    step_number: 5,
    title: "Human Overrides & Decision Authority",
    description:
      "Examine all instances where human users overrode model recommendations. " +
      "Verify that overrides are documented with reason, justification, " +
      "approver identity, and timestamp. Confirm decision authority hierarchy.",
    what_to_verify: [
      "Every override has a documented reason and justification",
      "Override approver has appropriate role authority",
      "Override severity is correctly classified",
      "No model output was accepted without human review opportunity",
      "Overrides appear in credit decision audit and examiner drop",
    ],
    artifacts_to_review: [
      "credit-decision/snapshot.json → overrides section",
      "credit-decision/snapshot.pdf → Human Overrides section",
    ],
    playbook_reference: "Override Handling",
    verification_action: "Verify each override has non-empty reason, justification, and approved_by_user_id",
  },
  {
    step_number: 6,
    title: "Attestation Chain & Committee Record",
    description:
      "Review the attestation chain — every human who signed off on the " +
      "decision. If committee review was required, verify quorum, vote " +
      "counts, dissent opinions, and minutes.",
    what_to_verify: [
      "At least one attestation exists for the final decision",
      "Attestation snapshot hashes are present and non-empty",
      "Committee quorum was met (if committee review required)",
      "Dissent opinions are recorded (if any members dissented)",
      "Committee minutes are available and hashed",
      "All votes include voter identity and timestamp",
    ],
    artifacts_to_review: [
      "credit-decision/snapshot.json → attestations section",
      "credit-decision/snapshot.json → committee section",
      "credit-decision/snapshot.pdf → Attestation Chain + Committee Record",
    ],
    playbook_reference: "Underwriting Flow → Committee Review",
    verification_action: "Verify committee.vote_count >= committee.quorum (if committee required)",
  },
  {
    step_number: 7,
    title: "Package Integrity Verification",
    description:
      "Verify the tamper-evident integrity of the entire examiner drop " +
      "package. Recompute SHA-256 checksums for all files and compare " +
      "against the manifest. Verify the aggregate drop hash.",
    what_to_verify: [
      "Every file in the package has a SHA-256 checksum in the manifest",
      "Recomputed checksums match manifest values",
      "Drop hash matches the X-Buddy-Drop-Hash response header",
      "Manifest artifact count matches actual file count",
      "All content_type values are correct",
    ],
    artifacts_to_review: [
      "integrity/manifest.json",
      "integrity/checksums.txt",
      "README.txt",
    ],
    playbook_reference: "Audit Artifacts Map → Verification",
    verification_action: "Run: sha256sum -c integrity/checksums.txt",
  },
];
