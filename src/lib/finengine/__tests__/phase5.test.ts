import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getProfile, listProfiles } from "@/lib/finengine/profiles";
import { isProductCutOver } from "@/lib/finengine/featureFlags";
import { sizeCre, sizeBorrowingBase, sizeCapLine, size504, sizeAcquisition } from "@/lib/finengine/sizing";
import { checkEligibility, detectSopExceptions, type SbaApplication } from "@/lib/finengine/sba/eligibility";
import { computeArEligibility, computeCollateralPosition, arInventoryComponents, monitorCollateral } from "@/lib/finengine/collateral";

describe("product profiles (config, not engines)", () => {
  it("has the priority products with sizing constraints", () => {
    for (const id of ["CI_TERM", "SBA_7A_STANDARD", "SBA_7A_SMALL", "SBA_504"]) {
      const p = getProfile(id);
      assert.ok(p, `missing ${id}`);
      assert.ok(p!.sizingConstraints.length > 0);
    }
    assert.ok(listProfiles().length >= 15);
  });
});

describe("feature flags default OFF (legacy path)", () => {
  it("no product is cut over by default", () => {
    assert.equal(isProductCutOver("CI_TERM"), false);
    assert.equal(isProductCutOver("SBA_504"), false);
  });
  it("an explicit flag flips a single product", () => {
    assert.equal(isProductCutOver("CI_TERM", { CI_TERM: true }), true);
    assert.equal(isProductCutOver("SBA_504", { CI_TERM: true }), false);
  });
});

describe("sizing — most-restrictive-of (V5.1)", () => {
  it("CRE binds on the lowest of LTV / DSCR / debt yield", () => {
    const r = sizeCre({ propertyValue: 1_000_000, noi: 90_000, annualConstantRate: 0.08, minDebtYield: 0.09, ctx: { productId: "CRE_INVESTOR" } });
    // LTV: 750k; DSCR: (90k/1.2)/0.08 = 937.5k; debtYield: 90k/0.09 = 1,000k → binding = LTV 750k
    assert.equal(r.bindingConstraint?.name, "LTV");
    assert.equal(r.maxLoan, 750_000);
  });

  it("ABL borrowing base = AR advance + inventory advance", () => {
    const r = sizeBorrowingBase({ eligibleAR: 1_000_000, eligibleInventoryNOLV: 400_000, ctx: { productId: "ABL_REVOLVER" } });
    // 1,000,000*0.8 + 400,000*0.5 = 800,000 + 200,000
    assert.equal(r.maxLoan, 1_000_000);
  });

  it("Contract CAPLine = greater of contract costs or 120% of deficit", () => {
    const r = sizeCapLine({ type: "contract", contractCosts: 500_000, greatestProjectedDeficit: 450_000 });
    assert.equal(r.maxLoan, Math.max(500_000, 450_000 * 1.2));
  });

  it("504 stack is 50/40/10 with occupancy gate; special-purpose raises equity", () => {
    const base = size504({ totalProjectCost: 1_000_000, occupancyPct: 0.6 });
    assert.equal(base.bankFirst, 500_000);
    assert.equal(base.equity, 100_000); // 10%
    assert.equal(base.occupancyOk, true);
    const sp = size504({ totalProjectCost: 1_000_000, occupancyPct: 0.4, isSpecialPurpose: true, isNewBusinessOrSingleUse: true });
    assert.equal(sp.equityPct, 0.2); // 10 + 5 + 5
    assert.equal(sp.occupancyOk, false); // 40% < 51%
  });

  it("acquisition combines buyer+seller normalized earnings; full-standby seller note counts as equity", () => {
    const r = sizeAcquisition({ buyerNormalizedEbitda: 200_000, sellerNormalizedEbitda: 300_000, annualConstantRate: 0.1, sellerNoteFullStandby: true, sellerNoteAmount: 100_000 });
    assert.equal(r.combinedEbitda, 500_000);
    assert.equal(r.sellerNoteCountsAsEquity, true);
  });
});

describe("SBA eligibility + SOP exception detector (V5.2)", () => {
  const baseApp: SbaApplication = {
    program: "7A_STANDARD",
    forProfit: true,
    meetsSizeStandard: true,
    ownershipDocumentedPct: 1,
    ownersUsCitizenOrNational: true,
    ownersPrincipalResidenceInUs: true,
    creditElsewhereAvailable: false,
    equityInjectionPct: 0.12,
    usesOfProceeds: [{ code: "WORKING_CAPITAL", amount: 500_000 }],
    affiliationResolved: true,
    fourTwentyFiveSixCOrdered: true,
  };

  it("a clean application is eligible", () => {
    const r = checkEligibility(baseApp);
    assert.equal(r.eligible, true);
  });

  it("flags a seeded ineligible use of proceeds", () => {
    const bad = { ...baseApp, usesOfProceeds: [{ code: "PASSIVE_REAL_ESTATE_INVESTMENT", amount: 300_000 }] };
    const r = checkEligibility(bad);
    assert.equal(r.eligible, false);
    const ex = detectSopExceptions(bad);
    assert.ok(ex.some((e) => e.rule === "use_of_proceeds" && e.status === "FAIL"));
  });

  it("flags below-minimum equity injection", () => {
    const r = checkEligibility({ ...baseApp, equityInjectionPct: 0.05 });
    assert.ok(r.findings.some((f) => f.rule === "equity_injection" && f.status === "FAIL"));
  });

  // SBA Procedural Notice 5000-876626 (eff. 2026-03-01): lawful permanent
  // residents are categorically ineligible owners, full stop — this field
  // used to treat LPR as passing (was named ownersUsCitizenOrLpr).
  it("flags LPR ownership as ineligible (post-2026-03-01 SOP)", () => {
    const r = checkEligibility({ ...baseApp, ownersUsCitizenOrNational: false });
    assert.equal(r.eligible, false);
    const ex = detectSopExceptions({ ...baseApp, ownersUsCitizenOrNational: false });
    assert.ok(ex.some((e) => e.rule === "citizenship" && e.status === "FAIL"));
  });

  // Same notice, separate gating condition: a citizen/national whose
  // principal residence is outside the US/its territories is also
  // ineligible — independent of the citizenship check passing.
  it("flags principal residence outside the US as ineligible even when citizenship passes", () => {
    const r = checkEligibility({ ...baseApp, ownersPrincipalResidenceInUs: false });
    assert.equal(r.eligible, false);
    const ex = detectSopExceptions({ ...baseApp, ownersPrincipalResidenceInUs: false });
    assert.ok(ex.some((e) => e.rule === "principal_residence" && e.status === "FAIL"));
  });
});

describe("collateral lifecycle", () => {
  it("AR eligibility removes >90/cross-aged/contra/governmental/foreign and over-concentration", () => {
    const r = computeArEligibility({ total: 1_000_000, over90: 100_000, crossAgedIneligible: 50_000, contra: 20_000, governmental: 30_000, foreign: 0, topDebtorConcentration: 0.3, concentrationCap: 0.2 });
    // 1,000,000 - 200,000 = 800,000; concentration excess 10% of 1,000,000 = 100,000 → 700,000
    assert.equal(r.eligible, 700_000);
  });

  it("collateral shortfall requires guarantor support; sufficiency assessed", () => {
    const comps = arInventoryComponents(1_000_000, 200_000, { productId: "ABL_REVOLVER" });
    const pos = computeCollateralPosition({ components: comps, loanExposure: 1_200_000, guarantorLiquidity: 500_000 });
    // discounted = 1,000,000*0.8 + 200,000*0.5 = 900,000; shortfall = 300,000; guarantor 500k sufficient
    assert.equal(pos.discountedValue, 900_000);
    assert.equal(pos.shortfall, 300_000);
    assert.equal(pos.guarantorSupportRequired, true);
    assert.equal(pos.guarantorSupportSufficient, true);
  });

  it("monitoring re-tests over the loan life (stale appraisal / unperfected lien)", () => {
    const r = monitorCollateral({ appraisalAgeMonths: 30, lienPerfected: false, uccFiled: true, insuranceAdequate: true });
    assert.equal(r.healthy, false);
    assert.ok(r.flags.length >= 2);
  });
});
