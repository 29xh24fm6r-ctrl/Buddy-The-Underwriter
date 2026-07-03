/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 11 tests.
 *
 * Eligible / ineligible / incomplete cases, plus the structure layer (EPC/OC,
 * standby, guarantor, collateral, insurance, franchise) and the non-negotiable
 * "never claims approval" guarantee.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  assembleSbaIntelligence,
  guarantorRequirements,
  collateralAdequacy,
  treatStandbyDebt,
  franchiseCheck,
  type SbaIntelligenceInput,
} from "@/lib/finengine/sba";
import type { SbaApplication } from "@/lib/finengine/sba";

const eligibleApp: SbaApplication = {
  program: "7A_STANDARD",
  forProfit: true,
  meetsSizeStandard: true,
  ownershipDocumentedPct: 1,
  ownersUsCitizenOrLpr: true,
  creditElsewhereAvailable: false,
  equityInjectionPct: 0.15,
  usesOfProceeds: [{ code: "WORKING_CAPITAL", amount: 500_000 }],
  affiliationResolved: true,
  fourTwentyFiveSixCOrdered: true,
};

describe("PR11 — eligible case", () => {
  it("assembles eligible with no blockers and never claims approval", () => {
    const r = assembleSbaIntelligence({ app: eligibleApp, loanAmount: 500_000 });
    assert.equal(r.eligible, true);
    assert.deepEqual(r.blockers, []);
    assert.equal(r.approvalClaim, "NOT_AN_APPROVAL");
  });
});

describe("PR11 — ineligible case", () => {
  it("credit available elsewhere → ineligible + blocker", () => {
    const r = assembleSbaIntelligence({
      app: { ...eligibleApp, creditElsewhereAvailable: true },
      loanAmount: 500_000,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.includes("credit_elsewhere"));
  });

  it("ineligible use of proceeds → blocker", () => {
    const r = assembleSbaIntelligence({
      app: { ...eligibleApp, usesOfProceeds: [{ code: "SPECULATION", amount: 100_000 }] },
      loanAmount: 500_000,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.includes("use_of_proceeds"));
  });
});

describe("PR11 — incomplete case (unresolved determinations, not blockers)", () => {
  it("unresolved affiliation + 4506-C surface as determinations", () => {
    const r = assembleSbaIntelligence({
      app: { ...eligibleApp, affiliationResolved: false, fourTwentyFiveSixCOrdered: false },
      loanAmount: 500_000,
    });
    // Still eligible (no FAIL), but with unresolved items + required docs.
    assert.equal(r.eligible, true);
    assert.ok(r.unresolvedDeterminations.includes("affiliation"));
    assert.ok(r.unresolvedDeterminations.includes("irs_4506c"));
    assert.ok(r.requiredDocuments.includes("IRS Form 4506-C"));
  });
});

describe("PR11 — structure layer", () => {
  it("guarantor: 20%+ owner without guaranty is a blocker", () => {
    const f = guarantorRequirements([
      { ownerName: "A", ownershipPct: 0.5, personalGuaranteeObtained: false },
      { ownerName: "B", ownershipPct: 0.1, personalGuaranteeObtained: false }, // <20% not required
    ]);
    assert.equal(f.length, 1);
    assert.equal(f[0].status, "FAIL");
  });

  it("collateral: undersecured is an EXCEPTION (condition), not ineligibility", () => {
    const { coverage, findings } = collateralAdequacy(
      [{ description: "Equipment", type: "M&E", value: 300_000, discountRate: 0.5 }],
      500_000,
    );
    assert.ok(Math.abs(coverage! - 150_000 / 500_000) < 1e-9);
    assert.equal(findings[0].status, "EXCEPTION");
  });

  it("standby: full-standby executed seller note counts toward equity", () => {
    const { qualifyingStandbyForEquity } = treatStandbyDebt([
      { creditorName: "Seller", amount: 200_000, fullStandby: true, standbyAgreementExecuted: true, isSellerNote: true },
      { creditorName: "Other", amount: 50_000, fullStandby: false, standbyAgreementExecuted: true },
    ]);
    assert.equal(qualifyingStandbyForEquity, 200_000);
  });

  it("franchise not in directory is a blocker", () => {
    const r = assembleSbaIntelligence({
      app: eligibleApp,
      loanAmount: 500_000,
      isFranchise: true,
      franchiseInSbaDirectory: false,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockers.includes("franchise_directory"));
  });

  it("EPC/OC missing OC guaranty is a blocker; missing lease assignment is a determination", () => {
    const r = assembleSbaIntelligence({
      app: eligibleApp,
      loanAmount: 500_000,
      epcOc: { isEpcOc: true, ocGuarantees: false, leaseAssignmentInPlace: false },
    });
    assert.ok(r.blockers.includes("epc_oc_oc_guaranty"));
    assert.ok(r.unresolvedDeterminations.includes("epc_oc_lease_assignment"));
  });

  it("insurance required-but-not-in-place → determination + required doc", () => {
    const r = assembleSbaIntelligence({
      app: eligibleApp,
      loanAmount: 500_000,
      insurance: [{ type: "FLOOD", required: true, inPlace: false }],
    });
    assert.ok(r.unresolvedDeterminations.includes("insurance_flood"));
    assert.ok(r.requiredDocuments.includes("Flood Insurance Policy"));
  });
});

describe("PR11 — franchise helper direct", () => {
  it("no franchise → no findings", () => {
    assert.deepEqual(franchiseCheck(false, undefined), []);
  });
});
