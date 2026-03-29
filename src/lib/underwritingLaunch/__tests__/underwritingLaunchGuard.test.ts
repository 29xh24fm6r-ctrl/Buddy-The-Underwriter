import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { computeUnderwritingEligibility } from "../computeEligibility";
import { buildSpreadSeedPackage, buildMemoSeedPackage } from "../buildSeedPackages";
import { detectUnderwritingDrift } from "../detectDrift";
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

// ─── Eligibility ──────────────────────────────────────────────────────────────

describe("computeUnderwritingEligibility", () => {
  it("eligible when all requirements met", () => {
    const result = computeUnderwritingEligibility(baseEligibility());
    assert.equal(result.status, "eligible");
    assert.equal(result.canLaunch, true);
    assert.equal(result.reasonsNotReady.length, 0);
  });

  it("not ready when loan request missing", () => {
    const result = computeUnderwritingEligibility(baseEligibility({ loanRequestStatus: "missing" }));
    assert.equal(result.status, "not_ready");
    assert.equal(result.canLaunch, false);
    assert.ok(result.reasonsNotReady.some((r) => r.includes("loan request")));
  });

  it("not ready when loan request incomplete", () => {
    const result = computeUnderwritingEligibility(baseEligibility({ loanRequestStatus: "draft" }));
    assert.equal(result.canLaunch, false);
  });

  it("not ready when blocking blockers exist", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      blockers: [{ code: "required_documents_missing" }],
    }));
    assert.equal(result.canLaunch, false);
  });

  it("not ready when requirements unsatisfied", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      applicableRequiredSatisfiedCount: 3,
      applicableRequiredTotalCount: 5,
    }));
    assert.equal(result.canLaunch, false);
    assert.ok(result.reasonsNotReady.some((r) => r.includes("2 applicable")));
  });

  it("not ready when deal identity invalid", () => {
    const result = computeUnderwritingEligibility(baseEligibility({ hasBorrowerId: false }));
    assert.equal(result.canLaunch, false);
    assert.ok(result.reasonsNotReady.some((r) => r.includes("Borrower")));
  });

  it("launched_with_drift when workspace exists with drift", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      hasExistingWorkspace: true,
      hasDrift: true,
    }));
    assert.equal(result.status, "launched_with_drift");
  });

  it("launched when workspace exists without drift", () => {
    const result = computeUnderwritingEligibility(baseEligibility({
      hasExistingWorkspace: true,
    }));
    assert.equal(result.status, "launched");
  });

  it("deterministic", () => {
    const input = baseEligibility({ loanRequestStatus: "draft" });
    const r1 = computeUnderwritingEligibility(input);
    const r2 = computeUnderwritingEligibility(input);
    assert.deepEqual(r1, r2);
  });
});

// ─── Drift detection ──────────────────────────────────────────────────────────

describe("detectUnderwritingDrift", () => {
  const baseDrift = {
    snapshotLoanAmount: 500000,
    snapshotLoanType: "term",
    snapshotCollateralType: "real_estate",
    snapshotConfirmedDocIds: ["d1", "d2", "d3"],
    snapshotRequirementSatisfiedCount: 5,
    currentLoanAmount: 500000,
    currentLoanType: "term",
    currentCollateralType: "real_estate",
    currentConfirmedDocIds: ["d1", "d2", "d3"],
    currentRequirementSatisfiedCount: 5,
    currentBlockerCount: 0,
  };

  it("no drift when nothing changed", () => {
    const result = detectUnderwritingDrift(baseDrift);
    assert.equal(result.hasDrift, false);
    assert.equal(result.severity, null);
  });

  it("material drift on loan amount change >10%", () => {
    const result = detectUnderwritingDrift({ ...baseDrift, currentLoanAmount: 600000 });
    assert.equal(result.hasDrift, true);
    assert.equal(result.severity, "material");
  });

  it("material drift on loan type change", () => {
    const result = detectUnderwritingDrift({ ...baseDrift, currentLoanType: "revolver" });
    assert.equal(result.hasDrift, true);
    assert.ok(result.items.some((i) => i.code === "loan_type_changed"));
  });

  it("material drift on confirmed doc removed", () => {
    const result = detectUnderwritingDrift({ ...baseDrift, currentConfirmedDocIds: ["d1", "d2"] });
    assert.equal(result.hasDrift, true);
    assert.ok(result.items.some((i) => i.code === "confirmed_doc_removed"));
  });

  it("material drift on new blockers", () => {
    const result = detectUnderwritingDrift({ ...baseDrift, currentBlockerCount: 2 });
    assert.equal(result.hasDrift, true);
  });

  it("deterministic", () => {
    const r1 = detectUnderwritingDrift(baseDrift);
    const r2 = detectUnderwritingDrift(baseDrift);
    assert.deepEqual(r1, r2);
  });
});

// ─── Seed packages ────────────────────────────────────────────────────────────

describe("buildSpreadSeedPackage", () => {
  const data = {
    snapshotId: "snap-1",
    borrowerLegalName: "Test LLC",
    borrowerEntityType: "llc",
    dealName: "Test Deal",
    bankName: "Test Bank",
    launchedAt: "2026-01-01",
    launchedBy: "user-1",
    loanRequest: { loanAmount: 500000, loanType: "term", facilityPurpose: "working_capital", collateralType: "real_estate" },
    confirmedDocuments: [
      { requirementCode: "financials.business_tax_returns", documentId: "d1", fileName: "btr_2024.pdf", canonicalDocType: "business_tax_return", periodYear: 2024 },
      { requirementCode: "financials.ytd_income_statement", documentId: "d2", fileName: "ytd_is.pdf", canonicalDocType: "income_statement" },
    ],
  };

  it("builds spread seed from snapshot", () => {
    const seed = buildSpreadSeedPackage(data);
    assert.equal(seed.snapshotId, "snap-1");
    assert.equal(seed.borrower.legalName, "Test LLC");
    assert.equal(seed.financialDocuments.length, 2);
    assert.ok(seed.financialPeriodSummary.businessTaxReturnYears.includes(2024));
    assert.equal(seed.financialPeriodSummary.hasYtdIncomeStatement, true);
  });

  it("builds memo seed from snapshot", () => {
    const seed = buildMemoSeedPackage(data);
    assert.equal(seed.snapshotId, "snap-1");
    assert.equal(seed.deal.borrowerLegalName, "Test LLC");
    assert.equal(seed.request.loanAmount, 500000);
    assert.equal(seed.launchContext.launchedBy, "user-1");
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Underwriting launch pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");
  const PURE_FILES = ["types.ts", "computeEligibility.ts", "buildSeedPackages.ts", "detectDrift.ts"];

  it("no DB imports", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f}`);
    }
  });

  it("no Math.random", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f}`);
    }
  });

  it("launch route creates snapshot + workspace + certification", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../app/api/deals/[dealId]/launch-underwriting/route.ts"),
      "utf-8",
    );
    assert.ok(content.includes("underwriting_launch_snapshots"));
    assert.ok(content.includes("underwriting_workspaces"));
    assert.ok(content.includes("underwriting_launch_certifications"));
    assert.ok(content.includes("underwriting_launched"));
  });

  it("launch route rejects without certification", () => {
    const content = fs.readFileSync(
      path.resolve(__dirname, "../../../app/api/deals/[dealId]/launch-underwriting/route.ts"),
      "utf-8",
    );
    assert.ok(content.includes("certification_checked"));
    assert.ok(content.includes("Certification checkbox is required"));
  });
});
