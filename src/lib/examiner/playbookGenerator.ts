/**
 * Examiner Playbook Generator (Phase I)
 *
 * Generates human-readable, regulator-grade playbooks that pre-answer
 * examiner questions and prevent audit drift, escalation, and
 * "can you also send…" loops.
 *
 * These are documents, not APIs. Written in plain English,
 * regulator tone, zero marketing language.
 *
 * Invariants:
 *  - Content is static and deterministic
 *  - No marketing or promotional language
 *  - Every playbook is self-contained
 *  - All references point to artifacts in the Examiner Drop ZIP
 */

export type ExaminerPlaybooks = {
  playbook_version: "1.0";
  generated_at: string;
  system_overview: string;
  underwriting_flow: string;
  ai_usage_explanation: string;
  borrower_verification: string;
  credit_decision_process: string;
  override_handling: string;
  audit_artifacts_map: string;
};

/**
 * Generate the complete examiner playbook bundle.
 * All content is static — no DB or AI calls.
 */
export function generateExaminerPlaybooks(): ExaminerPlaybooks {
  return {
    playbook_version: "1.0",
    generated_at: new Date().toISOString(),
    system_overview: SYSTEM_OVERVIEW,
    underwriting_flow: UNDERWRITING_FLOW,
    ai_usage_explanation: AI_USAGE_EXPLANATION,
    borrower_verification: BORROWER_VERIFICATION,
    credit_decision_process: CREDIT_DECISION_PROCESS,
    override_handling: OVERRIDE_HANDLING,
    audit_artifacts_map: AUDIT_ARTIFACTS_MAP,
  };
}

// ── 1. System Overview ──────────────────────────────────

const SYSTEM_OVERVIEW = `\
SYSTEM OVERVIEW
===============

What Buddy Is
-------------
Buddy The Underwriter is a regulated financial decisioning system of record
designed to assist community banks and commercial lenders with underwriting
workflow automation. Buddy processes loan applications through a structured
pipeline: intake, borrower verification, financial analysis, credit decision,
and regulatory export.

What Buddy Is Not
-----------------
Buddy is not an autonomous decision-making system. It does not approve or
decline loans. It does not replace human judgment. It does not have access
to borrower funds, accounts, or the ability to execute financial transactions.

System Boundaries
-----------------
- Buddy operates within a single bank tenant at a time.
- All data is tenant-isolated: Bank A cannot access Bank B's data.
- AI models operate in assistive-only mode with no decision authority.
- All credit decisions require explicit human approval.
- All exports are tamper-evident with SHA-256 integrity verification.
- Raw borrower PII (full SSN, full EIN) is never stored in AI model outputs.
- All timestamps are UTC ISO-8601.
`;

// ── 2. Underwriting Flow ────────────────────────────────

const UNDERWRITING_FLOW = `\
UNDERWRITING FLOW
=================

Buddy processes each deal through a structured, auditable pipeline:

1. INTAKE
   - Deal is created with basic borrower name and loan amount.
   - Documents are uploaded (tax returns, spreads, rent rolls, appraisals).
   - Documents are classified by type and OCR-processed.

2. BORROWER VERIFICATION
   - Borrower identity fields are extracted from documents.
   - Extraction confidence is scored per field (0.0 to 1.0).
   - Ownership is extracted from K-1 schedules and tax returns.
   - Human attestation is required before underwriting can proceed.
   --> Human Checkpoint: Borrower Attestation

3. FINANCIAL ANALYSIS
   - Financial facts are extracted from tax returns and spreads.
   - Key metrics are computed: DSCR, LTV, NOI, collateral coverage.
   - Stress scenarios are applied (rate shock, vacancy increase).
   - Data conflicts are resolved by source priority (Manual > Spread > Extract).
   --> Human Checkpoint: Financial Review

4. CREDIT DECISION
   - Bank credit policy rules are evaluated against deal metrics.
   - Risk narrative and confidence scores are generated.
   - Policy exceptions are flagged.
   - Decision snapshot is created (immutable).
   --> Human Checkpoint: Underwriter Decision + Attestation

5. COMMITTEE REVIEW (if applicable)
   - Committee members vote on the decision.
   - Quorum rules are enforced.
   - Dissent opinions are recorded.
   - Minutes are generated.
   --> Human Checkpoint: Committee Vote

6. REGULATORY EXPORT
   - Borrower Audit Snapshot (Phase E)
   - Credit Decision Audit Pack (Phase F)
   - Examiner Drop ZIP (Phase G)
   - All artifacts are tamper-evident with SHA-256 hashes.

Every transition between stages is logged in the deal pipeline ledger.
`;

// ── 3. AI Usage Explanation ─────────────────────────────

const AI_USAGE_EXPLANATION = `\
AI USAGE EXPLANATION
====================

Where AI Is Used
----------------
Buddy uses AI models in four specific, bounded scopes:

1. BORROWER EXTRACTION (model: borrower_extraction)
   - Extracts borrower identity fields from uploaded documents.
   - Outputs: legal name, entity type, EIN, NAICS, address, owners.
   - Confidence scored per field. Low-confidence fields flagged for review.

2. FINANCIAL NORMALIZATION (model: financial_normalization)
   - Normalizes financial data from tax returns and spreads.
   - Outputs: income, expenses, NOI, DSCR, LTV, collateral metrics.
   - Conflicting data resolved by source priority, not AI preference.

3. RISK FACTOR ANALYSIS (model: risk_factor_analysis)
   - Analyzes risk factors against bank credit policy.
   - Outputs: decision recommendation, confidence, risk narrative.
   - Policy rule evaluation is deterministic (not AI-driven).

4. PRICING RECOMMENDATION (model: pricing_recommendation)
   - Generates indicative pricing based on risk and policy.
   - Outputs: rate, spread, fees, risk grade.
   - All pricing is indicative — human lock required.

Where AI Is Prohibited
----------------------
AI is never used for:
- Final credit decisions (always human-owned)
- Regulatory reporting
- Customer communications
- Fund transfers or account modifications
- Override approval (human-only)

Why Humans Remain Accountable
-----------------------------
Every AI output in Buddy is:
- Versioned (model_id + model_version)
- Scoped (declared input/output boundaries)
- Explainable (limitations and confidence notes included)
- Overrideable (human can reject any model output)

The system enforces that no model has "decision_authority" other than
"assistive-only" and "human_override_required" is always true.

This is validated at runtime and included in the governance appendix.
`;

// ── 4. Borrower Verification ────────────────────────────

const BORROWER_VERIFICATION = `\
BORROWER VERIFICATION
=====================

Document Sourcing
-----------------
Borrower identity is established from uploaded documents:
- IRS Form 1120 (C-Corporation)
- IRS Form 1065 (Partnership)
- IRS Form 1120S (S-Corporation)
- IRS Form 1040 (Individual / Sole Proprietor)
- State formation documents
- Articles of incorporation

All documents receive SHA-256 hashes at upload time for integrity tracking.

Extraction Confidence
---------------------
Each extracted field carries a confidence score (0.0 to 1.0):
- >= 0.85: HIGH — Field is likely accurate
- 0.60 to 0.84: REVIEW — Field should be manually verified
- < 0.60: LOW — Field is unreliable and requires manual entry

Confidence is computed by the borrower_extraction model and reflects
OCR quality, document format consistency, and cross-reference alignment.

Ownership Attestation
---------------------
Ownership data is sourced exclusively from the attestation snapshot:
- Owners are extracted from K-1 schedules and tax return schedules
- Only owners with >= 20% ownership are tracked for regulatory purposes
- A human must attest to ownership accuracy before underwriting proceeds
- Attested ownership is immutable — changes require a new attestation

The Borrower Audit Snapshot (Phase E) captures the complete attested state.

EIN Handling
------------
- Full EIN is extracted from documents for matching purposes only.
- EIN is immediately masked to **-***NNNN format in all outputs.
- Full EIN is never stored in model outputs, logs, or audit artifacts.
`;

// ── 5. Credit Decision Process ──────────────────────────

const CREDIT_DECISION_PROCESS = `\
CREDIT DECISION PROCESS
========================

Policy Application
------------------
Each bank uploads its credit policy, which is parsed into:
- Deterministic rules (DSCR minimums, LTV maximums, etc.)
- Policy chunks (narrative guidance, sector-specific requirements)
- Policy defaults (standard terms for deal types)

Rules are evaluated programmatically. Policy chunks are retrieved via
semantic search and provided as context to the risk analysis model.

Risk Grading
------------
Risk is assessed along multiple dimensions:
- Cash flow adequacy (DSCR, debt coverage)
- Collateral coverage (LTV, discounted values)
- Borrower quality (entity type, ownership structure, history)
- Concentration risk (sector, geography, borrower exposure)
- Stress resilience (rate shock, vacancy, rent decline)

The risk_factor_analysis model generates a confidence score and narrative.
Policy rule evaluation is deterministic and does not use AI.

Decision Snapshot
-----------------
When a credit decision is made, an immutable snapshot is created containing:
- Decision (approve / approve_with_conditions / decline / needs_more_info)
- Confidence and explanation
- All inputs (financial metrics, policy rules, evidence)
- Policy evaluation results
- Exceptions and overrides

Once status is set to "final", the snapshot cannot be modified.
This is enforced at the database level via triggers.

Pricing Derivation
------------------
Pricing is derived from:
- Risk grade assignment
- Bank pricing policy
- Market benchmarks
- Stress scenario outcomes

All pricing is indicative until a human locks the quote.
Locked quotes are immutable and included in the committee packet.
`;

// ── 6. Override Handling ────────────────────────────────

const OVERRIDE_HANDLING = `\
OVERRIDE HANDLING
=================

When Overrides Occur
--------------------
An override occurs when a human user disagrees with a model recommendation
and explicitly changes a value. Common scenarios:
- Underwriter adjusts AI-suggested DSCR calculation
- Credit officer overrides risk grade
- Committee changes decision from "approve" to "approve_with_conditions"
- Pricing officer adjusts indicative rate

Who Can Approve Overrides
-------------------------
Overrides are recorded by the user who makes the change. The system
tracks the user ID and timestamp. Override approval authority is
determined by the bank's role hierarchy:
- Underwriter: Can override extraction and financial normalization outputs
- Credit Officer: Can override risk analysis and decision recommendations
- Committee Chair: Can override committee-level decisions
- Risk Officer: Can override any model output with documented justification

How Overrides Are Recorded
--------------------------
Every override creates an immutable record containing:
- field_path: Which value was changed (e.g., "decision.outcome")
- old_value: The original model-suggested value
- new_value: The human-determined value
- reason: Why the override was made
- justification: Detailed explanation for audit purposes
- severity: Impact level (info / warning / critical)
- created_by_user_id: Who made the override
- created_at: When the override was made

Overrides appear in:
- Credit Decision Audit Pack (Phase F snapshot)
- Examiner Drop ZIP (Phase G)
- Deal Pipeline Ledger

Overrides are never deleted or modified after creation.
`;

// ── 7. Audit Artifacts Map ──────────────────────────────

const AUDIT_ARTIFACTS_MAP = `\
AUDIT ARTIFACTS MAP
===================

Where to Find Everything in the Examiner Drop ZIP
--------------------------------------------------

FILE                                    CONTENTS
----                                    --------
README.txt                              Package overview and integrity instructions

borrower-audit/snapshot.json            Borrower identity, ownership, extraction
                                        provenance, attestation record, lifecycle
                                        events (Phase E canonical format)

borrower-audit/snapshot.pdf             Human-readable borrower audit PDF with
                                        7 sections: summary, ownership, documents,
                                        confidence, attestation, lifecycle, integrity

credit-decision/snapshot.json           Credit decision, financial metrics, policy
                                        evaluation, human overrides, attestation chain,
                                        committee record (Phase F canonical format)

credit-decision/snapshot.pdf            Human-readable credit decision audit PDF with
                                        8 sections: decision, financials, policy,
                                        overrides, attestations, committee, ledger,
                                        integrity

financials/financial-snapshot.json      Deal financial metrics snapshot including
                                        DSCR, LTV, NOI, collateral coverage,
                                        completeness percentage, and source provenance

policies/policy-eval.json               Full policy evaluation record with rule
                                        results, compliance scores, and evidence

policies/exceptions.json                Policy exceptions with rule keys, severity
                                        levels, and reasons

policies/model-governance.json          AI model governance appendix: registry,
                                        explainability, override policy, human-in-
                                        the-loop guarantees

playbooks/examiner-playbooks.json       This document in machine-readable format

playbooks/examiner-playbooks.pdf        This document in human-readable PDF format

integrity/checksums.txt                 SHA-256 checksums for every file in the
                                        package (sha256sum compatible)

integrity/manifest.json                 Artifact inventory with per-file hashes,
                                        sizes, content types, and the aggregate
                                        drop hash

VERIFICATION
------------
To verify package integrity:

  sha256sum -c integrity/checksums.txt

The drop_hash in manifest.json is the aggregate integrity hash
computed from all individual artifact checksums.
`;
