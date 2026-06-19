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
  it("Omnicare-like: submitted LR + structural pricing + incomplete memo + no risk pricing → NOT Finalize Pricing", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized", "Risk pricing must be reviewed and finalized before advancing to committee"),
      b("missing_management_profile", "Add a management profile"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.equal(a.label, "Continue Underwriting");
    // subtext names the most important (memo) blocker, and routes to memo work — not pricing
    assert.equal(a.description, "Add a management profile");
    assert.match(a.href ?? "", /memo-inputs/);
  });

  it("mature: only risk pricing missing (all prerequisites complete) → Finalize Pricing", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized", "Risk pricing must be reviewed and finalized before advancing to committee"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.equal(a.label, "Finalize Pricing");
    assert.match(a.href ?? "", /\/pricing$/);
  });

  it("document reconciliation outranks pricing → Continue Underwriting pointing at documents", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("gatekeeper_docs_need_review", "2 document(s) require review"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.equal(a.label, "Continue Underwriting");
    assert.equal(a.description, "2 document(s) require review");
    assert.match(a.href ?? "", /documents/);
  });

  it("financial-computation readiness outranks pricing", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("missing_dscr", "DSCR not computed"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.equal(a.description, "DSCR not computed");
  });

  it("financial validation outranks pricing", () => {
    const s = state("underwrite_in_progress", [
      b("risk_pricing_not_finalized"),
      b("financial_validation_open", "2 unresolved financial validation item(s)"),
    ]);
    const a = buildJourneyPrimaryAction(s, DEAL);
    assert.notEqual(a.label, "Finalize Pricing");
    assert.equal(a.description, "2 unresolved financial validation item(s)");
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
    assert.equal(a.description, "No loan request has been created for this deal");
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
