import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectDealType } from "../dealTypeDetection";

describe("dealTypeDetection", () => {
  it("returns explicit override when deal_type_override fact is set", () => {
    assert.equal(detectDealType({ deal_type_override: "sba_7a" }), "sba_7a");
  });

  it("ignores invalid deal_type_override values", () => {
    assert.equal(detectDealType({ deal_type_override: "not_a_type" }), "c_and_i");
  });

  it("detects CRE investor from appraisal + rental income", () => {
    assert.equal(
      detectDealType({ appraised_value: 1_000_000, rental_income: 100_000 }),
      "cre_investor",
    );
  });

  it("detects CRE investor via appraisal_present + SCH_E_RENTS_RECEIVED", () => {
    assert.equal(
      detectDealType({ appraisal_present: true, SCH_E_RENTS_RECEIVED: 50_000 }),
      "cre_investor",
    );
  });

  it("detects CRE construction from construction_budget_present", () => {
    assert.equal(
      detectDealType({ construction_budget_present: true }),
      "cre_construction",
    );
  });

  it("detects CRE construction from loan_purpose containing construction", () => {
    assert.equal(
      detectDealType({ loan_purpose: "Ground-up Construction" }),
      "cre_construction",
    );
  });

  it("detects SBA 7(a) from sba_form_present", () => {
    assert.equal(detectDealType({ sba_form_present: true }), "sba_7a");
  });

  it("detects SBA from loan_purpose containing sba", () => {
    assert.equal(detectDealType({ loan_purpose: "SBA 7(a) loan" }), "sba_7a");
  });

  it("detects CRE investor when rental income is >80% of revenue", () => {
    assert.equal(
      detectDealType({ rental_income: 900_000, TOTAL_REVENUE: 1_000_000 }),
      "cre_investor",
    );
  });

  it("does NOT detect CRE when rental is <80% of revenue (no appraisal)", () => {
    assert.equal(
      detectDealType({ rental_income: 500_000, TOTAL_REVENUE: 1_000_000 }),
      "c_and_i",
    );
  });

  it("detects professional practice from healthcare NAICS + sole_prop", () => {
    assert.equal(
      detectDealType({ naics_code: "621111", entity_type: "sole_prop" }),
      "professional_practice",
    );
  });

  it("detects professional practice from healthcare NAICS + s_corp", () => {
    assert.equal(
      detectDealType({ naics_code: "621310", entity_type: "s_corp" }),
      "professional_practice",
    );
  });

  it("does NOT detect professional practice for NAICS 62 without matching entity type", () => {
    assert.equal(
      detectDealType({ naics_code: "621111", entity_type: "c_corp" }),
      "c_and_i",
    );
  });

  it("detects equipment from high PP&E ratio + equipment loan purpose", () => {
    assert.equal(
      detectDealType({ bs_ppe_net: 800_000, TOTAL_ASSETS: 1_000_000, loan_purpose: "equipment purchase" }),
      "equipment",
    );
  });

  it("detects holding company from entity_roles + entity_count", () => {
    assert.equal(
      detectDealType({ entity_roles: ["re_holding", "opco"], entity_count: 3 }),
      "holding_company",
    );
  });

  it("detects agriculture from NAICS 11", () => {
    assert.equal(detectDealType({ naics_code: "111100" }), "agriculture");
  });

  it("detects CRE owner-occupied from real estate NAICS 53", () => {
    assert.equal(
      detectDealType({ naics_code: "531110" }),
      "cre_owner_occupied",
    );
  });

  it("defaults to c_and_i for empty facts", () => {
    assert.equal(detectDealType({}), "c_and_i");
  });

  it("defaults to c_and_i for unknown data", () => {
    assert.equal(detectDealType({ some_random_key: 42 }), "c_and_i");
  });

  it("prioritizes explicit deal_type_override over other signals", () => {
    assert.equal(
      detectDealType({
        deal_type_override: "agriculture",
        appraised_value: 1_000_000,
        rental_income: 100_000,
      }),
      "agriculture",
    );
  });

  it("prioritizes CRE investor (appraisal+rental) over SBA", () => {
    const result = detectDealType({
      appraised_value: 1_000_000,
      rental_income: 100_000,
      sba_form_present: true,
    });
    assert.equal(result, "cre_investor");
  });
});
