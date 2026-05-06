import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockerGatesStage } from "../../../buddy/lifecycle/blockerToStage";
import type { LifecycleBlockerCode, LifecycleStage } from "../../../buddy/lifecycle/model";

/**
 * Exhaustive list mirroring LifecycleBlockerCode in src/buddy/lifecycle/model.ts.
 * If the union changes, TypeScript's `satisfies` check below fails, and the
 * function itself has a `never` exhaustiveness guard.
 */
const ALL_BLOCKER_CODES = [
  "identity_not_verified",
  "financial_snapshot_missing",
  "underwrite_not_started",
  "underwrite_incomplete",
  "policy_exceptions_unresolved",
  "committee_packet_missing",
  "decision_missing",
  "attestation_missing",
  "closing_docs_missing",
  "pricing_quote_missing",
  "risk_pricing_not_finalized",
  "deal_not_found",
  "checklist_not_seeded",
  "loan_request_missing",
  "loan_request_incomplete",
  "spreads_incomplete",
  "pricing_assumptions_required",
  "structural_pricing_missing",
  "gatekeeper_docs_need_review",
  "gatekeeper_docs_incomplete",
  "checklist_fetch_failed",
  "snapshot_fetch_failed",
  "decision_fetch_failed",
  "attestation_fetch_failed",
  "packet_fetch_failed",
  "advancement_fetch_failed",
  "readiness_fetch_failed",
  "schema_mismatch",
  "intake_health_below_threshold",
  "intake_confirmation_required",
  "financial_snapshot_stale",
  "financial_validation_open",
  "financial_snapshot_build_failed",
  "critical_flags_unresolved",
  "borrower_not_attached",
  "artifacts_processing_stalled",
  "data_fetch_failed",
  "internal_error",
] as const satisfies readonly LifecycleBlockerCode[];

const VALID_STAGES: ReadonlySet<LifecycleStage> = new Set([
  "intake_created",
  "docs_requested",
  "docs_in_progress",
  "docs_satisfied",
  "underwrite_ready",
  "underwrite_in_progress",
  "committee_ready",
  "committee_decisioned",
  "closing_in_progress",
  "closed",
  "workout",
]);

describe("blockerGatesStage — document blockers", () => {
  it("checklist_not_seeded → docs_requested", () => {
    assert.equal(blockerGatesStage("checklist_not_seeded"), "docs_requested");
  });

  it("borrower_not_attached → docs_requested", () => {
    assert.equal(blockerGatesStage("borrower_not_attached"), "docs_requested");
  });

  it("loan_request_missing → docs_requested", () => {
    assert.equal(blockerGatesStage("loan_request_missing"), "docs_requested");
  });

  it("loan_request_incomplete → docs_requested", () => {
    assert.equal(blockerGatesStage("loan_request_incomplete"), "docs_requested");
  });

  it("intake_health_below_threshold → docs_in_progress", () => {
    assert.equal(blockerGatesStage("intake_health_below_threshold"), "docs_in_progress");
  });

  it("intake_confirmation_required → docs_in_progress", () => {
    assert.equal(blockerGatesStage("intake_confirmation_required"), "docs_in_progress");
  });

  it("gatekeeper_docs_incomplete → docs_satisfied", () => {
    assert.equal(blockerGatesStage("gatekeeper_docs_incomplete"), "docs_satisfied");
  });

  it("gatekeeper_docs_need_review → docs_satisfied", () => {
    assert.equal(blockerGatesStage("gatekeeper_docs_need_review"), "docs_satisfied");
  });

  it("artifacts_processing_stalled → docs_satisfied", () => {
    assert.equal(blockerGatesStage("artifacts_processing_stalled"), "docs_satisfied");
  });
});

describe("blockerGatesStage — underwriting blockers", () => {
  it("financial_snapshot_missing → underwrite_ready", () => {
    assert.equal(blockerGatesStage("financial_snapshot_missing"), "underwrite_ready");
  });

  it("spreads_incomplete → underwrite_ready", () => {
    assert.equal(blockerGatesStage("spreads_incomplete"), "underwrite_ready");
  });

  it("pricing_assumptions_required → underwrite_ready", () => {
    assert.equal(blockerGatesStage("pricing_assumptions_required"), "underwrite_ready");
  });

  it("structural_pricing_missing → underwrite_ready", () => {
    assert.equal(blockerGatesStage("structural_pricing_missing"), "underwrite_ready");
  });

  it("financial_snapshot_stale → underwrite_ready", () => {
    assert.equal(blockerGatesStage("financial_snapshot_stale"), "underwrite_ready");
  });

  it("financial_validation_open → underwrite_ready", () => {
    assert.equal(blockerGatesStage("financial_validation_open"), "underwrite_ready");
  });

  it("financial_snapshot_build_failed → underwrite_ready", () => {
    assert.equal(blockerGatesStage("financial_snapshot_build_failed"), "underwrite_ready");
  });

  it("underwrite_not_started → underwrite_in_progress", () => {
    assert.equal(blockerGatesStage("underwrite_not_started"), "underwrite_in_progress");
  });

  it("underwrite_incomplete → underwrite_in_progress", () => {
    assert.equal(blockerGatesStage("underwrite_incomplete"), "underwrite_in_progress");
  });

  it("critical_flags_unresolved → underwrite_in_progress", () => {
    assert.equal(blockerGatesStage("critical_flags_unresolved"), "underwrite_in_progress");
  });
});

describe("blockerGatesStage — committee blockers", () => {
  it("committee_packet_missing → committee_ready", () => {
    assert.equal(blockerGatesStage("committee_packet_missing"), "committee_ready");
  });

  it("decision_missing → committee_decisioned", () => {
    assert.equal(blockerGatesStage("decision_missing"), "committee_decisioned");
  });

  it("policy_exceptions_unresolved → committee_decisioned", () => {
    assert.equal(blockerGatesStage("policy_exceptions_unresolved"), "committee_decisioned");
  });
});

describe("blockerGatesStage — closing blockers", () => {
  it("attestation_missing → closing_in_progress", () => {
    assert.equal(blockerGatesStage("attestation_missing"), "closing_in_progress");
  });

  it("closing_docs_missing → closing_in_progress", () => {
    assert.equal(blockerGatesStage("closing_docs_missing"), "closing_in_progress");
  });

  it("pricing_quote_missing → closing_in_progress", () => {
    assert.equal(blockerGatesStage("pricing_quote_missing"), "closing_in_progress");
  });

  it("risk_pricing_not_finalized → closing_in_progress", () => {
    assert.equal(blockerGatesStage("risk_pricing_not_finalized"), "closing_in_progress");
  });
});

describe("blockerGatesStage — infrastructure blockers", () => {
  const infraCodes: LifecycleBlockerCode[] = [
    "deal_not_found",
    "schema_mismatch",
    "internal_error",
    "data_fetch_failed",
    "checklist_fetch_failed",
    "snapshot_fetch_failed",
    "decision_fetch_failed",
    "attestation_fetch_failed",
    "packet_fetch_failed",
    "advancement_fetch_failed",
    "readiness_fetch_failed",
  ];

  for (const code of infraCodes) {
    it(`${code} → null (rail-level banner)`, () => {
      assert.equal(blockerGatesStage(code), null);
    });
  }
});

describe("blockerGatesStage — exhaustiveness", () => {
  it("every blocker code maps to a valid stage or null (never undefined)", () => {
    for (const code of ALL_BLOCKER_CODES) {
      const result = blockerGatesStage(code);
      assert.notStrictEqual(result, undefined, `${code} returned undefined`);
      if (result !== null) {
        assert.ok(
          VALID_STAGES.has(result),
          `${code} mapped to invalid stage ${result}`,
        );
      }
    }
  });

  it("identity_not_verified is mapped (covered by spec delta — see AAR)", () => {
    // Spec did not include identity_not_verified. We map it to docs_requested.
    assert.equal(blockerGatesStage("identity_not_verified"), "docs_requested");
  });
});
