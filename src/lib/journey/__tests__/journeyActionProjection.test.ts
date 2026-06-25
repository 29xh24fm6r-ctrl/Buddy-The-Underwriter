/**
 * SPEC-JOURNEY-RAIL-UNDERWRITING-FLOW-PRIORITY-1 — primary-action projection tests.
 *
 * Pins the banker-flow priority: in underwrite_in_progress the rail must not present "Finalize Pricing"
 * while earlier underwriting prerequisites (documents / financial / spread / memo / validation) are
 * incomplete. Placed under src/lib so the `test:unit` gate (src/lib|scripts|src/app) runs it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildJourneyPrimaryAction,
  getWorkstreamSummary,
  workstreamForBlocker,
} from "../journeyActionProjection";
import type { LifecycleBlocker, LifecycleState, LifecycleStage } from "@/buddy/lifecycle/model";

const DEAL = "deal-omni";

const derived: LifecycleState["derived"] = {
  readinessMode: "disabled",
  documentsReady: true,
  documentsReadinessPct: 100,
  underwriteStarted: true,
  financialSnapshotExists: true,
  committeePacketReady: false,
  decisionPresent: false,
  committeeRequired: false,
  pricingQuoteReady: false,
  riskPricingFinalized: false,
  attestationSatisfied: true,
  aiPipelineComplete: true,
  spreadsComplete: true,
  structuralPricingReady: true,
  hasPricingAssumptions: true,
  hasSubmittedLoanRequest: true,
  hasLoanRequestWithAmount: true,
  researchComplete: true,
  criticalFlagsResolved: true,
};

const state = (stage: LifecycleStage, blockers: LifecycleBlocker[]): LifecycleState => ({
  stage,
  lastAdvancedAt: null,
  blockers,
  derived,
});

const b = (code: LifecycleBlocker["code"], message: string = code): LifecycleBlocker => ({ code, message });

describe("buildJourneyPrimaryAction — underwrite_in_progress priority", () => {
  it("Omnicare-like: submitted LR + structural pricing + incomplete memo + no risk pricing → specific memo CTA, not Finalize Pricing or Continue Underwriting", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized", "Risk pricing must be reviewed and finalized before advancing to committee"),
      b("missing_management_profile", "Add a management profile"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.notEqual(a.label, "Continue Underwriting");
    // exact fix-action label for the highest-priority (memo) blocker, routing to memo work — not pricing
    assert.equal(a.label, "Add management profile");
    assert.match(a.href ?? "", /memo-inputs/);
    // description leads with the blocker message and notes that work remains after this step
    assert.match(a.description ?? "", /^Add a management profile/);
    assert.match(a.description ?? "", /Other underwriting items remain open after this step\./);
  });

  it("mature: only risk pricing missing (all prerequisites complete) → Finalize Pricing", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized", "Risk pricing must be reviewed and finalized before advancing to committee"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Finalize Pricing");
    assert.match(a.href ?? "", /\/pricing$/);
  });

  it("document reconciliation outranks pricing → specific document CTA, not Continue Underwriting", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("gatekeeper_docs_need_review", "2 document(s) require review"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.notEqual(a.label, "Continue Underwriting");
    assert.equal(a.label, "Review Documents");
    assert.match(a.description ?? "", /^2 document\(s\) require review/);
    assert.match(a.href ?? "", /documents/);
  });

  it("financial-computation readiness outranks pricing → Run financial analysis", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("missing_dscr", "DSCR not computed"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    // SPEC-FINANCIALS-BEFORE-GCF-SEQUENCING-1: DSCR is downstream of business
    // financials/ADS/GCF — route to the upstream financial-analysis hub, not a
    // GCF compute dead-end.
    assert.equal(a.label, "Run financial analysis");
    assert.match(a.href ?? "", /\/financials$/);
    assert.match(a.description ?? "", /^DSCR not computed/);
  });

  it("financial validation outranks pricing → Resolve financial validation", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("financial_validation_open", "2 unresolved financial validation item(s)"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.equal(a.label, "Resolve financial validation");
    assert.match(a.description ?? "", /^2 unresolved financial validation item\(s\)/);
  });

  it("single non-pricing workstream → that specific action (not neutral)", () => {
    const s = state("underwrite_in_progress", [b("missing_research_quality_gate", "Run research")]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Continue Underwriting");
    assert.equal(a.label, "Run research");
  });

  it("a genuinely missing loan request still wins as the top workstream", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("loan_request_missing", "No loan request has been created for this deal"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.equal(a.label, "Add Loan Request");
    assert.match(a.description ?? "", /^No loan request has been created for this deal/);
    assert.match(a.href ?? "", /loan-request/);
  });

  it("pricing + committee both pending (no earlier prereqs) → Finalize Pricing (pricing before committee)", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("committee_packet_missing"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Finalize Pricing");
  });

  it("no recognized underwriting blockers → defers to stage default (Complete Underwriting)", () => {
    const s = state("underwrite_in_progress", []);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Complete Underwriting");
  });

  it("full OmniCare fixture (docs + memo + financial + pricing all open) → Finalize required documents, never Continue Underwriting", () => {
    const s = state("underwrite_in_progress", [
      b("unfinalized_required_documents", "3 required document(s) are not finalized"),
      b("missing_business_description", "Add a business description"),
      b("missing_management_profile", "Add a management profile"),
      b("missing_collateral_item", "Add collateral"),
      b("missing_dscr", "DSCR not computed"),
      b("missing_global_cash_flow", "Global cash flow not computed"),
      b("missing_research_quality_gate", "Run research"),
      b("risk_pricing_not_finalized", "Finalize pricing"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Finalize required documents");
    assert.notEqual(a.label, "Continue Underwriting");
    assert.notEqual(a.label, "Finalize Pricing");
    assert.notEqual(a.label, "Add Loan Request");
    assert.match(a.href ?? "", /intake/);
    assert.match(a.description ?? "", /Other underwriting items remain open after this step\./);
  });

  it("critical rule: a fixable top blocker never yields Continue Underwriting", () => {
    const codes: LifecycleBlocker["code"][] = [
      "unfinalized_required_documents",
      "gatekeeper_docs_need_review",
      "missing_business_description",
      "missing_management_profile",
      "missing_collateral_item",
      "missing_dscr",
      "missing_global_cash_flow",
      "financial_validation_open",
      "risk_pricing_not_finalized",
    ];
    for (const code of codes) {
      const a = buildJourneyPrimaryAction(state("underwrite_in_progress", [b(code)]), DEAL);
      assert.notEqual(a.label, "Continue Underwriting", `${code} should produce a specific CTA`);
    }
  });
});

describe("getWorkstreamSummary", () => {
  it("single workstream → just the blocker message", () => {
    assert.equal(
      getWorkstreamSummary("memo_inputs", { code: "missing_management_profile", message: "Add a management profile" }, false),
      "Add a management profile",
    );
  });

  it("multiple workstreams → appends the remaining-items note (with sentence separator)", () => {
    assert.equal(
      getWorkstreamSummary("documents", { code: "gatekeeper_docs_need_review", message: "2 documents require review" }, true),
      "2 documents require review. Other underwriting items remain open after this step.",
    );
  });

  it("multiple workstreams, message already ends with punctuation → single space, no double period", () => {
    assert.equal(
      getWorkstreamSummary("documents", { code: "unfinalized_required_documents", message: "Documents are not finalized." }, true),
      "Documents are not finalized. Other underwriting items remain open after this step.",
    );
  });
});

describe("buildJourneyPrimaryAction — non-underwriting stages defer to getNextAction", () => {
  it("no loan request at docs_in_progress still shows Add Loan Request", () => {
    const s = state("docs_in_progress", [b("loan_request_missing", "No loan request has been created for this deal")]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Add Loan Request");
    assert.match(a.href ?? "", /loan-request/);
  });

  it("committee_ready is unchanged (Record Decision)", () => {
    const s = state("committee_ready", []);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Record Decision");
  });

  it("closed stage is unchanged (terminal)", () => {
    const s = state("closed", []);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.intent, "complete");
  });
});

describe("workstreamForBlocker — priority mapping", () => {
  it("risk pricing codes are LATE (risk_pricing workstream)", () => {
    assert.equal(workstreamForBlocker("risk_pricing_not_finalized"), "risk_pricing");
    assert.equal(workstreamForBlocker("structural_pricing_missing"), "risk_pricing");
  });
  it("memo/document/financial codes map to earlier workstreams", () => {
    assert.equal(workstreamForBlocker("missing_management_profile"), "memo_inputs");
    assert.equal(workstreamForBlocker("gatekeeper_docs_need_review"), "documents");
    assert.equal(workstreamForBlocker("missing_dscr"), "financial_computation");
    assert.equal(workstreamForBlocker("financial_validation_open"), "financial_validation");
  });
  it("an unmapped infra code returns null", () => {
    assert.equal(workstreamForBlocker("internal_error"), null);
  });
});

// SPEC-CHECKLIST-DOCUMENT-SATISFACTION-RECONCILIATION-1 — Required test #5.
// Proves the rail self-corrects through the lifecycle blocker set: it shows the
// document-finalization CTA only while `unfinalized_required_documents` is present,
// and stops showing it once the (now-satisfied) PFS_CURRENT blocker is gone. The
// rail is never patched directly — correctness flows from the blocker set.
describe("Omnicare PFS reconciliation — rail self-corrects via blockers", () => {
  it("BEFORE reconciliation: unfinalized_required_documents → rail CTA is the document-finalization action", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized", "Risk pricing must be finalized before committee"),
      b("unfinalized_required_documents", "Buddy is still processing 1 required document"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    // documents workstream outranks pricing → the exact stale CTA the banker saw.
    assert.equal(a.label, "Finalize required documents");
    assert.match(a.href ?? "", /\/intake$/);
  });

  it("AFTER reconciliation: blocker removed, no other document blocker → rail CTA is NOT the document-finalization action", () => {
    // PFS_CURRENT is now satisfied, so the memo-input layer no longer emits
    // unfinalized_required_documents. Only the late pricing gate remains.
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized", "Risk pricing must be finalized before committee"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize required documents");
    assert.equal(a.label, "Finalize Pricing");
    assert.doesNotMatch(a.href ?? "", /\/intake$/);
  });

  it("AFTER reconciliation with zero blockers → neutral stage action, never the document CTA", () => {
    const s = state("underwrite_in_progress", []);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize required documents");
  });
});

// SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1 — Required test #6.
// Once canonical readiness removes the stale document blocker, the rail must
// advance to the next TRUE blocker's action — proving the rail self-corrects
// through the blocker set, with no CTA wording patch.
describe("canonical readiness convergence — rail advances to the next true blocker", () => {
  it("document blocker present → can be Finalize required documents", () => {
    const s = state("underwrite_in_progress", [
      b("unfinalized_required_documents", "Buddy is still processing 1 required document"),
      b("missing_dscr", "DSCR not computed"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Finalize required documents");
  });

  it("document blocker removed → advances to the next true blocker (financial), not a UX patch", () => {
    const s = state("underwrite_in_progress", [b("missing_dscr", "DSCR not computed")]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize required documents");
    assert.equal(a.label, "Run financial analysis");
    assert.match(a.href ?? "", /\/financials$/);
  });
});
