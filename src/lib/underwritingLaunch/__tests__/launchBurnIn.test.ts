import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { computeUnderwritingEligibility } from "../computeEligibility";
import { detectCanonicalDrift } from "../detectCanonicalDrift";
import type { EligibilityInput } from "../types";

function baseEligibility(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    blockers: [],
    loanRequestStatus: "complete",
    hasDealName: true,
    hasBorrowerId: true,
    hasBankId: true,
    applicableRequiredSatisfiedCount: 5,
    applicableRequiredTotalCount: 5,
    hasExistingWorkspace: false,
    hasDrift: false,
    ...overrides,
  };
}

const RESOLVER_PATH = path.resolve(__dirname, "../getCanonicalLoanRequest.ts");
const COCKPIT_PATH = path.resolve(__dirname, "../../../app/api/deals/[dealId]/cockpit-state/route.ts");
const LAUNCH_PATH = path.resolve(__dirname, "../../../app/api/deals/[dealId]/launch-underwriting/route.ts");

// ─── Part 1: Fallback removal verification ────────────────────────────────────

describe("Fallback removal — no legacy loan_requests reads", () => {
  it("canonical resolver has no Phase 55 fallback", () => {
    const content = fs.readFileSync(RESOLVER_PATH, "utf-8");
    assert.ok(!content.includes('from("loan_requests")'), "Resolver must not query legacy loan_requests");
    assert.ok(content.includes("EXCLUSIVE canonical source"));
  });

  it("cockpit-state has no Phase 55 fallback", () => {
    const content = fs.readFileSync(COCKPIT_PATH, "utf-8");
    assert.ok(!content.includes('from("loan_requests")'), "Cockpit-state must not query legacy loan_requests");
    assert.ok(!content.includes("migration period only"));
    assert.ok(content.includes("No fallback") || content.includes("Canonical only"));
  });

  it("launch route does not query legacy loan_requests", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    assert.ok(!content.includes('from("loan_requests")'), "Launch route must not query legacy loan_requests");
  });

  it("launch route uses getCanonicalLoanRequestForUnderwriting", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    assert.ok(content.includes("getCanonicalLoanRequestForUnderwriting"));
  });
});

// ─── Part 2: Launch regression matrix ─────────────────────────────────────────

describe("Launch regression matrix — eligibility scenarios", () => {
  it("Scenario A: clean launch — eligible", () => {
    const result = computeUnderwritingEligibility(baseEligibility());
    assert.equal(result.status, "eligible");
    assert.equal(result.canLaunch, true);
    assert.equal(result.reasonsNotReady.length, 0);
  });

  it("Scenario B: already activated — launched status", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      hasExistingWorkspace: true,
    }));
    assert.equal(result.status, "launched");
    assert.equal(result.canLaunch, false); // can't re-launch, must use relaunch
  });

  it("Scenario C: blocked by missing checklist — not ready", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      blockers: [{ code: "required_documents_missing" }],
    }));
    assert.equal(result.status, "not_ready");
    assert.equal(result.canLaunch, false);
  });

  it("Scenario D: no submitted canonical request — not ready", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      loanRequestStatus: "missing",
    }));
    assert.equal(result.status, "not_ready");
    assert.equal(result.canLaunch, false);
    assert.ok(result.reasonsNotReady.some((r) => r.includes("loan request")));
  });

  it("Scenario D.2: draft-only request — not ready", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      loanRequestStatus: "draft",
    }));
    assert.equal(result.canLaunch, false);
  });

  it("Scenario E: no pricing assumptions — lifecycle blocks before launch reaches eligibility", () => {
    // Pricing assumptions missing means lifecycle won't reach underwrite_ready.
    // The launch eligibility engine does NOT independently gate on pricing —
    // that is lifecycle's responsibility. If lifecycle somehow allowed this state,
    // launch would still succeed because pricing is not in BLOCKING_BLOCKER_CODES.
    // This test verifies launch does NOT add a second pricing gate.
    const result = computeUnderwritingEligibility(baseEligibility({
      blockers: [{ code: "pricing_assumptions_missing" }],
    }));
    // pricing_assumptions_missing is NOT a launch-blocking code — lifecycle gates this earlier
    assert.equal(result.status, "eligible");
    assert.equal(result.canLaunch, true);
  });

  it("Scenario F: underwrite_ready but no financial snapshot — depends on lifecycle policy", () => {
    // Financial snapshot is NOT a launch prerequisite per repo policy
    // It becomes relevant later in underwriting flow
    const result = computeUnderwritingEligibility(baseEligibility());
    assert.equal(result.canLaunch, true); // Financial snapshot not required for launch
  });
});

// ─── Part 2b: Launch wrapper guards ──────────────────────────────────────────

describe("Launch wrapper — structural guards", () => {
  it("launch route wraps ensureUnderwritingActivatedCore", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    assert.ok(content.includes("ensureUnderwritingActivatedCore"));
  });

  it("launch route does NOT directly mutate lifecycle_stage", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    const lines = content.split("\n").filter(
      (l) => !l.trim().startsWith("//") && l.includes("lifecycle_stage") && l.includes(".update"),
    );
    assert.equal(lines.length, 0, "Launch must not directly mutate lifecycle");
  });

  it("launch route rejects without certification", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    assert.ok(content.includes("Certification checkbox is required"));
  });

  it("launch route creates snapshot only after activation", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    // ensureUnderwritingActivatedCore must appear before underwriting_launch_snapshots insert
    const activationIdx = content.indexOf("ensureUnderwritingActivatedCore");
    const snapshotIdx = content.indexOf("underwriting_launch_snapshots");
    assert.ok(activationIdx < snapshotIdx, "Activation must happen before snapshot creation");
  });

  it("launch route stores canonical_loan_request_id", () => {
    const content = fs.readFileSync(LAUNCH_PATH, "utf-8");
    assert.ok(content.includes("canonical_loan_request_id"));
  });
});

// ─── Part 3: Drift regression ─────────────────────────────────────────────────

describe("Drift regression matrix", () => {
  const baseDrift = {
    snapshotCanonicalLoanRequestId: "lr-1",
    snapshotFinancialSnapshotId: "fs-1",
    snapshotLifecycleStage: "underwriting",
    snapshotDocumentsReadinessPct: 100,
    currentCanonicalLoanRequestId: "lr-1",
    currentCanonicalLoanRequestUpdatedAt: "2026-01-01",
    currentFinancialSnapshotId: "fs-1",
    currentLifecycleStage: "underwriting",
    currentDocumentsReadinessPct: 100,
    currentBlockerCount: 0,
    snapshotLoanAmount: 500000,
    currentLoanAmount: 500000,
    snapshotProductType: "term",
    currentProductType: "term",
    snapshotCollateralType: "real_estate",
    currentCollateralType: "real_estate",
  };

  it("Scenario G: canonical loan request replacement", () => {
    const result = detectCanonicalDrift({ ...baseDrift, currentCanonicalLoanRequestId: "lr-2" });
    assert.equal(result.hasDrift, true);
    assert.equal(result.severity, "material");
    assert.ok(result.items.some((i) => i.code === "canonical_loan_request_replaced"));
  });

  it("Scenario H: product type change", () => {
    const result = detectCanonicalDrift({ ...baseDrift, currentProductType: "revolver" });
    assert.equal(result.hasDrift, true);
    assert.ok(result.items.some((i) => i.code === "product_type_changed"));
  });

  it("Scenario I: financial snapshot change", () => {
    const result = detectCanonicalDrift({ ...baseDrift, currentFinancialSnapshotId: "fs-2" });
    assert.equal(result.hasDrift, true);
    assert.ok(result.items.some((i) => i.code === "financial_snapshot_changed"));
  });

  it("Scenario J: readiness regression", () => {
    const result = detectCanonicalDrift({ ...baseDrift, currentDocumentsReadinessPct: 60 });
    assert.equal(result.hasDrift, true);
    assert.equal(result.severity, "material");
  });

  it("Scenario K: non-material metadata — no drift", () => {
    const result = detectCanonicalDrift(baseDrift);
    assert.equal(result.hasDrift, false);
    assert.equal(result.severity, null);
  });
});

// ─── Part 4: Legacy snapshot compatibility ────────────────────────────────────

describe("Legacy snapshot compatibility", () => {
  it("drift handles missing canonical refs gracefully (null comparison)", () => {
    const result = detectCanonicalDrift({
      snapshotCanonicalLoanRequestId: null,
      snapshotFinancialSnapshotId: null,
      snapshotLifecycleStage: "underwriting",
      snapshotDocumentsReadinessPct: null,
      currentCanonicalLoanRequestId: "lr-1",
      currentCanonicalLoanRequestUpdatedAt: "2026-01-01",
      currentFinancialSnapshotId: "fs-1",
      currentLifecycleStage: "underwriting",
      currentDocumentsReadinessPct: 100,
      currentBlockerCount: 0,
      snapshotLoanAmount: null,
      currentLoanAmount: 500000,
      snapshotProductType: null,
      currentProductType: "term",
      snapshotCollateralType: null,
      currentCollateralType: "real_estate",
    });
    // Should NOT crash. May or may not detect drift depending on null handling,
    // but must not throw
    assert.ok(typeof result.hasDrift === "boolean");
  });

  it("drift returns stable result for identical null refs", () => {
    const result = detectCanonicalDrift({
      snapshotCanonicalLoanRequestId: null,
      snapshotFinancialSnapshotId: null,
      snapshotLifecycleStage: "underwriting",
      snapshotDocumentsReadinessPct: null,
      currentCanonicalLoanRequestId: null,
      currentCanonicalLoanRequestUpdatedAt: null,
      currentFinancialSnapshotId: null,
      currentLifecycleStage: "underwriting",
      currentDocumentsReadinessPct: null,
      currentBlockerCount: 0,
      snapshotLoanAmount: null,
      currentLoanAmount: null,
      snapshotProductType: null,
      currentProductType: null,
      snapshotCollateralType: null,
      currentCollateralType: null,
    });
    assert.equal(result.hasDrift, false);
  });
});

// ─── Part 5: Pure file guards ─────────────────────────────────────────────────

describe("56R.1 pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");

  it("all pure files have no DB imports", () => {
    for (const f of ["types.ts", "computeEligibility.ts", "buildSeedPackages.ts", "detectDrift.ts", "detectCanonicalDrift.ts"]) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("all pure files have no Math.random", () => {
    for (const f of ["types.ts", "computeEligibility.ts", "buildSeedPackages.ts", "detectDrift.ts", "detectCanonicalDrift.ts"]) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f}`);
    }
  });
});
