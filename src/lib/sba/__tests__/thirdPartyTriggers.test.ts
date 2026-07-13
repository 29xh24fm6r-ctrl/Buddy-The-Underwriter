import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateThirdPartyTriggers } from "@/lib/sba/thirdPartyTriggers";

const BASE_INPUT = {
  dealId: "d1",
  loanAmount: 40_000, // below the $50K hazard-insurance threshold — keeps this a true "minimal" fixture
  loanProgram: "sba_7a_standard",
  isAcquisition: false,
  isSingleOwnerBusiness: false,
  loanFullySecuredByHardCollateral: true,
  realEstateInUseOfProceeds: false,
  businessNaics: null,
};

test("evaluateThirdPartyTriggers: real estate in use of proceeds -> appraisal + title", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, realEstateInUseOfProceeds: true });
  const types = result.map((r) => r.order_type);
  assert.ok(types.includes("real_estate_appraisal"));
  assert.ok(types.includes("title_commitment"));
});

test("evaluateThirdPartyTriggers: acquisition + Standard 7(a) -> business_valuation", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, isAcquisition: true, loanProgram: "sba_7a_standard" });
  assert.ok(result.some((r) => r.order_type === "business_valuation"));
});

test("evaluateThirdPartyTriggers: acquisition + 7a Express -> NO business_valuation (Standard only)", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, isAcquisition: true, loanProgram: "sba_7a_express" });
  assert.ok(!result.some((r) => r.order_type === "business_valuation"));
});

test("evaluateThirdPartyTriggers: NAICS on Appendix 6 list -> phase_1_environmental", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, businessNaics: "812320" }); // dry cleaning
  assert.ok(result.some((r) => r.order_type === "phase_1_environmental"));
});

test("evaluateThirdPartyTriggers: NAICS not on Appendix 6 list -> no phase_1_environmental", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, businessNaics: "999999" });
  assert.ok(!result.some((r) => r.order_type === "phase_1_environmental"));
});

test("evaluateThirdPartyTriggers: loan > $50K -> hazard_insurance", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, loanAmount: 60_000 });
  assert.ok(result.some((r) => r.order_type === "hazard_insurance"));
});

test("evaluateThirdPartyTriggers: loan <= $50K -> no hazard_insurance", () => {
  const result = evaluateThirdPartyTriggers({ ...BASE_INPUT, loanAmount: 50_000 });
  assert.ok(!result.some((r) => r.order_type === "hazard_insurance"));
});

test("evaluateThirdPartyTriggers: loan > $350K, single-owner, not fully secured -> life_insurance", () => {
  const result = evaluateThirdPartyTriggers({
    ...BASE_INPUT,
    loanAmount: 400_000,
    isSingleOwnerBusiness: true,
    loanFullySecuredByHardCollateral: false,
  });
  assert.ok(result.some((r) => r.order_type === "life_insurance"));
});

test("evaluateThirdPartyTriggers: loan > $350K but fully secured -> no life_insurance", () => {
  const result = evaluateThirdPartyTriggers({
    ...BASE_INPUT,
    loanAmount: 400_000,
    isSingleOwnerBusiness: true,
    loanFullySecuredByHardCollateral: true,
  });
  assert.ok(!result.some((r) => r.order_type === "life_insurance"));
});

test("evaluateThirdPartyTriggers: ucc_lien_search always present, minimal deal -> only ucc_lien_search", () => {
  const result = evaluateThirdPartyTriggers(BASE_INPUT);
  assert.deepEqual(result.map((r) => r.order_type), ["ucc_lien_search"]);
});

test("evaluateThirdPartyTriggers: combined triggers (RE + acquisition + NAICS + large loan) -> all fire together", () => {
  const result = evaluateThirdPartyTriggers({
    dealId: "d1",
    loanAmount: 500_000,
    loanProgram: "sba_7a_standard",
    isAcquisition: true,
    isSingleOwnerBusiness: true,
    loanFullySecuredByHardCollateral: false,
    realEstateInUseOfProceeds: true,
    businessNaics: "812320",
  });
  const types = new Set(result.map((r) => r.order_type));
  assert.ok(types.has("real_estate_appraisal"));
  assert.ok(types.has("title_commitment"));
  assert.ok(types.has("business_valuation"));
  assert.ok(types.has("phase_1_environmental"));
  assert.ok(types.has("hazard_insurance"));
  assert.ok(types.has("life_insurance"));
  assert.ok(types.has("ucc_lien_search"));
});
