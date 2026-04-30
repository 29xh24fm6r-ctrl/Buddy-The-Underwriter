/**
 * Industry Intelligence — Tests
 *
 * Tests NAICS mapping, profile data, and industry-calibrated reasonableness checks.
 * All functions are pure — no DB stubs needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// Stub "server-only" so transitive imports don't throw in test context.
mockServerOnly();

describe("Industry Intelligence", async () => {
  const { getIndustryProfile, getIndustryDisplayName } = await import("../naicsMapper");
  const { MARITIME_PROFILE } = await import("../profiles/maritime");
  const { REAL_ESTATE_PROFILE } = await import("../profiles/realEstate");
  const { RESTAURANT_PROFILE } = await import("../profiles/restaurant");
  const { PROFESSIONAL_SERVICES_PROFILE } = await import("../profiles/professionalServices");
  const { DEFAULT_PROFILE } = await import("../profiles/default");
  const { checkReasonableness } = await import("../../irsKnowledge/reasonablenessEngine");

  // ── Test 1: NAICS 487210 → maritime profile ──────────────────────

  it("NAICS 487210 → maritime profile returned", () => {
    const profile = getIndustryProfile("487210");
    assert.equal(profile.displayName, "Maritime / Charter Boats");
    assert.equal(profile.interestInCogs, true);
    assert.equal(profile.naicsCode, "487210");
  });

  // ── Test 2: NAICS 53110 → real estate profile ────────────────────

  it("NAICS 53110 → realEstate profile returned", () => {
    const profile = getIndustryProfile("53110");
    assert.equal(profile.displayName, "Real Estate");
    assert.equal(profile.interestInCogs, false);
    assert.equal(profile.highDepreciationExpected, true);
  });

  // ── Test 3: null NAICS → default profile ─────────────────────────

  it("null NAICS → default profile returned", () => {
    const profile = getIndustryProfile(null);
    assert.equal(profile.displayName, "Unknown Industry");
    assert.equal(profile.naicsCode, "000000");
    assert.equal(profile.redFlags.length, 0);
  });

  // ── Test 4: Unknown NAICS "999999" → default profile ─────────────

  it("unknown NAICS 999999 → default profile returned", () => {
    const profile = getIndustryProfile("999999");
    assert.equal(profile.displayName, "Unknown Industry");
    assert.equal(getIndustryDisplayName("999999"), "Unknown Industry");
  });

  // ── Test 5: Maritime — interest-in-COGS warning ──────────────────

  it("maritime reasonableness — interest-in-COGS warning fires", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 800000,
      COST_OF_GOODS_SOLD: 300000,
      GROSS_PROFIT: 500000,
      ORDINARY_BUSINESS_INCOME: 200000,
      INTEREST_EXPENSE: null,
    };

    const results = checkReasonableness(facts, "FORM_1065", undefined, MARITIME_PROFILE);

    const interestWarning = results.find(r => r.checkId === "INDUSTRY_INTEREST_IN_COGS");
    assert.ok(interestWarning, "INDUSTRY_INTEREST_IN_COGS check should exist");
    assert.ok(interestWarning.description.includes("interest may be embedded in COGS"));
    assert.equal(interestWarning.passed, true); // warning only, not a failure

    // Also should get MARITIME_COGS_NO_INTEREST red flag
    const cogsFlag = results.find(r => r.checkId === "MARITIME_COGS_NO_INTEREST");
    assert.ok(cogsFlag, "MARITIME_COGS_NO_INTEREST red flag should fire");
    assert.equal(cogsFlag.passed, false);
  });

  // ── Test 6: Maritime — gross margin 0.38 triggers red flag ───────

  it("maritime reasonableness — gross margin 0.38 triggers MARITIME_MARGIN_LOW", () => {
    // Gross margin = 300000 / 1000000 = 0.30 < 0.35
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 1000000,
      COST_OF_GOODS_SOLD: 700000,
      GROSS_PROFIT: 300000,
      ORDINARY_BUSINESS_INCOME: 100000,
      INTEREST_EXPENSE: 20000,
    };

    const results = checkReasonableness(facts, "FORM_1065", undefined, MARITIME_PROFILE);

    const marginFlag = results.find(r => r.checkId === "MARITIME_MARGIN_LOW");
    assert.ok(marginFlag, "MARITIME_MARGIN_LOW red flag should fire");
    assert.equal(marginFlag.passed, false);
    assert.ok((marginFlag.value ?? 0) < 0.35);
  });

  // ── Test 7: Restaurant — food cost 44% triggers flag ─────────────

  it("restaurant reasonableness — food cost 44% triggers REST_FOOD_COST_HIGH", () => {
    // COGS / revenue = 440000 / 1000000 = 0.44 > 0.42
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 1000000,
      COST_OF_GOODS_SOLD: 440000,
      GROSS_PROFIT: 560000,
      ORDINARY_BUSINESS_INCOME: 100000,
    };

    const results = checkReasonableness(facts, "FORM_1120", undefined, RESTAURANT_PROFILE);

    const foodFlag = results.find(r => r.checkId === "REST_FOOD_COST_HIGH");
    assert.ok(foodFlag, "REST_FOOD_COST_HIGH should fire");
    assert.equal(foodFlag.passed, false);
    assert.ok((foodFlag.value ?? 0) > 0.42);
  });

  // ── Test 8: Professional services — gross margin 0.88 is NORMAL ──

  it("professional services — gross margin 0.88 is NORMAL (within 0.65-0.92)", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 500000,
      COST_OF_GOODS_SOLD: 60000,
      GROSS_PROFIT: 440000,
      ORDINARY_BUSINESS_INCOME: 200000,
      OFFICER_COMPENSATION: 150000, // 30% — within 20%-55% range
    };

    const results = checkReasonableness(facts, "FORM_1120", undefined, PROFESSIONAL_SERVICES_PROFILE);

    // Officer comp should pass with industry-calibrated thresholds (20%-55%)
    const compCheck = results.find(r => r.checkId === "OFFICER_COMP_EXTREME");
    assert.ok(compCheck, "OFFICER_COMP_EXTREME check should exist");
    assert.equal(compCheck.passed, true);

    // No margin-related red flags should fire (0.88 is fine for prof services)
    const marginFlags = results.filter(r =>
      r.checkId.includes("MARGIN") && !r.passed
    );
    assert.equal(marginFlags.length, 0);
  });

  // ── Test 9: Default profile — gross margin 0.15 is within defaults ─

  it("default profile — gross margin 0.15 does NOT trigger anomaly (within wide defaults)", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 1000000,
      COST_OF_GOODS_SOLD: 850000,
      GROSS_PROFIT: 150000,
      ORDINARY_BUSINESS_INCOME: 50000,
    };

    const results = checkReasonableness(facts, "FORM_1120", undefined, DEFAULT_PROFILE);

    // Default has no red flags so no industry-specific flags should fire
    const industryFlags = results.filter(r =>
      r.checkId.startsWith("MARITIME") ||
      r.checkId.startsWith("REST") ||
      r.checkId.startsWith("CONST") ||
      r.checkId.startsWith("MEDICAL") ||
      r.checkId.startsWith("PROSERV") ||
      r.checkId.startsWith("RE_") ||
      r.checkId.startsWith("RETAIL")
    );
    assert.equal(industryFlags.length, 0);

    // Universal checks should still run
    const cogsCheck = results.find(r => r.checkId === "COGS_EXCEEDS_REVENUE");
    assert.ok(cogsCheck);
    assert.equal(cogsCheck.passed, true);
  });

  // ── Test 10: Backward compatibility — no profile arg ─────────────

  it("reasonableness engine backward compatibility — calling without industry profile works", () => {
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 800000,
      COST_OF_GOODS_SOLD: 300000,
      GROSS_PROFIT: 500000,
      ORDINARY_BUSINESS_INCOME: 200000,
      OFFICER_COMPENSATION: 100000,
    };

    // Call without industryProfile — original 2-arg form
    const results = checkReasonableness(facts, "FORM_1120");

    // Should have universal checks
    const cogsCheck = results.find(r => r.checkId === "COGS_EXCEEDS_REVENUE");
    assert.ok(cogsCheck);
    assert.equal(cogsCheck.passed, true);

    // Officer comp with default 2%-50% range: 100000/800000 = 12.5% → NORMAL
    const compCheck = results.find(r => r.checkId === "OFFICER_COMP_EXTREME");
    assert.ok(compCheck);
    assert.equal(compCheck.passed, true);
    // Description should show default thresholds
    assert.ok(compCheck.description.includes("2%"));
    assert.ok(compCheck.description.includes("50%"));

    // No industry-specific flags
    const industryFlags = results.filter(r =>
      r.checkId.startsWith("INDUSTRY_") ||
      r.checkId.startsWith("MARITIME") ||
      r.checkId.startsWith("REST")
    );
    assert.equal(industryFlags.length, 0);
  });
});
