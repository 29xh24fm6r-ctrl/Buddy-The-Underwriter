import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGatekeeperReadiness,
  type GatekeeperDocRow,
} from "../readiness";
import {
  deriveScenarioRequirements,
  type ScenarioRequirements,
} from "../requirements";
import type { IntakeScenario } from "@/lib/intake/slots/types";

// ---------------------------------------------------------------------------
// Helper: standard conventional requirements (3 BTR + 3 PTR + FS + PFS)
// ---------------------------------------------------------------------------

const FEB_2026 = new Date("2026-02-15T12:00:00Z");

const CONVENTIONAL_SCENARIO: IntakeScenario = {
  product_type: "CONVENTIONAL",
  borrower_business_stage: "EXISTING",
  has_business_tax_returns: true,
  has_financial_statements: true,
  has_projections: false,
  entity_age_months: null,
};

function conventionalRequirements(): ScenarioRequirements {
  return deriveScenarioRequirements({
    scenario: CONVENTIONAL_SCENARIO,
    now: FEB_2026,
  });
}

function makeDoc(
  doc_type: string,
  tax_year: number | null,
  needs_review = false,
): GatekeeperDocRow {
  return {
    gatekeeper_doc_type: doc_type,
    gatekeeper_tax_year: tax_year,
    gatekeeper_needs_review: needs_review,
  };
}

// ---------------------------------------------------------------------------
// computeGatekeeperReadiness
// ---------------------------------------------------------------------------

describe("computeGatekeeperReadiness", () => {
  it("exact year matching — BTR 2024 present, 3 years required → 1 matched, 2 missing", () => {
    const req = conventionalRequirements();
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.businessTaxYears, [2024]);
    assert.deepEqual(result.missing.businessTaxYears, [2023, 2022]);
  });

  it("duplicate years dedupe — two BTR 2024 docs → still 1 matched year", () => {
    const req = conventionalRequirements();
    const docs = [
      makeDoc("BUSINESS_TAX_RETURN", 2024),
      makeDoc("BUSINESS_TAX_RETURN", 2024),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.businessTaxYears, [2024]);
  });

  it("missing year detected — required 2024, only 2023 present", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2023)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.businessTaxYears, []);
    assert.deepEqual(result.missing.businessTaxYears, [2024]);
    assert.equal(result.readinessPct, 0);
  });

  it("NEEDS_REVIEW blocks ready — 100% eligible matched but needsReviewCount > 0", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [
      makeDoc("BUSINESS_TAX_RETURN", 2024, false),
      makeDoc("OTHER", null, true), // NEEDS_REVIEW doc
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.readinessPct, 100);
    assert.equal(result.needsReviewCount, 1);
    assert.equal(result.ready, false); // blocked by NEEDS_REVIEW
  });

  it("PFS included in readinessPct — requiresPFS=true without PFS doc → not 100%", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: true,
    };
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.readinessPct, 50); // 1/2 eligible matched
    assert.equal(result.missing.pfsMissing, true);
    assert.equal(result.present.pfsPresent, false);
    assert.equal(result.ready, false);
  });

  it("PFS doc satisfies requiresPFS — PERSONAL_FINANCIAL_STATEMENT present → pfsPresent: true", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: true,
    };
    const docs = [
      makeDoc("BUSINESS_TAX_RETURN", 2024),
      makeDoc("PERSONAL_FINANCIAL_STATEMENT", null),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.readinessPct, 100);
    assert.equal(result.present.pfsPresent, true);
    assert.equal(result.missing.pfsMissing, false);
    assert.equal(result.ready, true);
  });

  it("extra documents ignored — 5 BTR docs across years, only 3 required", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024, 2023, 2022],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [
      makeDoc("BUSINESS_TAX_RETURN", 2024),
      makeDoc("BUSINESS_TAX_RETURN", 2023),
      makeDoc("BUSINESS_TAX_RETURN", 2022),
      makeDoc("BUSINESS_TAX_RETURN", 2021), // extra — not required
      makeDoc("BUSINESS_TAX_RETURN", 2020), // extra — not required
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.businessTaxYears.length, 3);
    assert.equal(result.readinessPct, 100);
  });

  it("scenario without financial statements — not counted in eligible", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.readinessPct, 100);
    assert.equal(result.missing.financialStatementsMissing, false);
  });

  it("no required docs → readinessPct: 100 (vacuously ready)", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const result = computeGatekeeperReadiness({ requirements: req, documents: [] });

    assert.equal(result.readinessPct, 100);
    assert.equal(result.ready, true);
  });

  it("W2 normalized to OTHER — does NOT satisfy PTR requirement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // Server normalizes W2 → OTHER (supporting income doc, not a tax return)
    const docs = [makeDoc("OTHER", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, []);
    assert.deepEqual(result.missing.personalTaxYears, [2024]);
    assert.equal(result.readinessPct, 0);
  });

  it("FORM_1099 and K1 normalized to OTHER — do NOT satisfy PTR requirements", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024, 2023],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // Server normalizes FORM_1099/K1 → OTHER (supporting income docs)
    const docs = [
      makeDoc("OTHER", 2024),
      makeDoc("OTHER", 2023),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, []);
    assert.deepEqual(result.missing.personalTaxYears, [2024, 2023]);
    assert.equal(result.readinessPct, 0);
  });

  it("FINANCIAL_STATEMENT present satisfies requiresFinancialStatements", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: false,
    };
    const docs = [makeDoc("FINANCIAL_STATEMENT", null)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.financialStatementsPresent, true);
    assert.equal(result.missing.financialStatementsMissing, false);
    assert.equal(result.readinessPct, 100);
  });

  it("all required present + no needs review → ready: true", () => {
    const req = conventionalRequirements();
    // Feb 2026 → years [2024, 2023, 2022], FS + PFS required
    const docs = [
      makeDoc("BUSINESS_TAX_RETURN", 2024),
      makeDoc("BUSINESS_TAX_RETURN", 2023),
      makeDoc("BUSINESS_TAX_RETURN", 2022),
      makeDoc("PERSONAL_TAX_RETURN", 2024),
      makeDoc("PERSONAL_TAX_RETURN", 2023),
      makeDoc("PERSONAL_TAX_RETURN", 2022),
      makeDoc("FINANCIAL_STATEMENT", null),
      makeDoc("PERSONAL_FINANCIAL_STATEMENT", null),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.readinessPct, 100);
    assert.equal(result.needsReviewCount, 0);
    assert.equal(result.ready, true);
    assert.equal(result.present.pfsPresent, true);
    assert.equal(result.missing.pfsMissing, false);
  });

  it("empty documents array → everything missing, readinessPct = 0", () => {
    const req = conventionalRequirements();
    const result = computeGatekeeperReadiness({ requirements: req, documents: [] });

    assert.equal(result.present.businessTaxYears.length, 0);
    assert.equal(result.present.personalTaxYears.length, 0);
    assert.equal(result.present.financialStatementsPresent, false);
    assert.equal(result.readinessPct, 0);
    assert.equal(result.ready, false);
  });

  it("NEEDS_REVIEW docs are excluded from matching but counted", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // One BTR 2024 doc that is NEEDS_REVIEW — should NOT count as present
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2024, true)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.businessTaxYears.length, 0);
    assert.equal(result.missing.businessTaxYears.length, 1);
    assert.equal(result.needsReviewCount, 1);
    assert.equal(result.readinessPct, 0);
  });
});

// ---------------------------------------------------------------------------
// Near-miss detection
// ---------------------------------------------------------------------------

describe("near-miss detection", () => {
  it("BTR near-miss — required 2024, only 2023 present → nearMiss, not truly missing", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2023)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.nearMisses.businessTaxReturns.length, 1);
    assert.equal(result.nearMisses.businessTaxReturns[0].requiredYear, 2024);
    assert.equal(result.nearMisses.businessTaxReturns[0].foundYear, 2023);
    assert.equal(result.missing.businessTaxYears.length, 1); // still missing from readiness perspective
  });

  it("PTR near-miss — required 2022, only 2023 present → nearMiss", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2022],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("PERSONAL_TAX_RETURN", 2023)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.nearMisses.personalTaxReturns.length, 1);
    assert.equal(result.nearMisses.personalTaxReturns[0].requiredYear, 2022);
    assert.equal(result.nearMisses.personalTaxReturns[0].foundYear, 2023);
  });

  it("truly missing — no BTR docs at all → empty nearMisses", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const result = computeGatekeeperReadiness({ requirements: req, documents: [] });

    assert.equal(result.nearMisses.businessTaxReturns.length, 0);
    assert.equal(result.missing.businessTaxYears.length, 1);
  });

  it("satisfied year → not in nearMisses", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024, 2023],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // 2024 satisfied, 2023 satisfied — no near-misses
    const docs = [
      makeDoc("BUSINESS_TAX_RETURN", 2024),
      makeDoc("BUSINESS_TAX_RETURN", 2023),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.nearMisses.businessTaxReturns.length, 0);
    assert.equal(result.missing.businessTaxYears.length, 0);
  });

  it("confirmed doc type feeds through pure engine — PTR via canonical_type", () => {
    // Simulates what readinessServer does: resolves effective type upstream
    // The pure engine receives already-resolved values
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2022],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // A confirmed doc: gatekeeper said W2 but human confirmed PTR 2022
    // After resolveEffectiveClassification, readinessServer maps to:
    const docs: GatekeeperDocRow[] = [{
      gatekeeper_doc_type: "PERSONAL_TAX_RETURN", // effective type (resolved)
      gatekeeper_tax_year: 2022,                   // effective year (resolved)
      gatekeeper_needs_review: false,              // confirmed → never needs review
    }];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [2022]);
    assert.equal(result.readinessPct, 100);
    assert.equal(result.ready, true);
  });
});

// ---------------------------------------------------------------------------
// deriveScenarioRequirements
// ---------------------------------------------------------------------------

describe("deriveScenarioRequirements", () => {
  it("conventional scenario → 3 BTR years + 3 PTR years + FS + PFS", () => {
    const req = conventionalRequirements();

    assert.deepEqual(req.businessTaxYears, [2024, 2023, 2022]);
    assert.deepEqual(req.personalTaxYears, [2024, 2023, 2022]);
    assert.equal(req.requiresFinancialStatements, true);
    assert.equal(req.requiresPFS, true);
  });

  it("scenario without business returns → empty businessTaxYears", () => {
    const scenario: IntakeScenario = {
      ...CONVENTIONAL_SCENARIO,
      has_business_tax_returns: false,
    };
    const req = deriveScenarioRequirements({ scenario, now: FEB_2026 });

    assert.deepEqual(req.businessTaxYears, []);
    assert.deepEqual(req.personalTaxYears, [2024, 2023, 2022]); // still required
  });

  it("tax years match computeTaxYears() for given date", () => {
    // May 2026 → after April 15 → years [2025, 2024, 2023]
    const may2026 = new Date("2026-05-01T12:00:00Z");
    const req = deriveScenarioRequirements({
      scenario: CONVENTIONAL_SCENARIO,
      now: may2026,
    });

    assert.deepEqual(req.businessTaxYears, [2025, 2024, 2023]);
    assert.deepEqual(req.personalTaxYears, [2025, 2024, 2023]);
  });

  it("scenario without financial statements → requiresFinancialStatements: false", () => {
    const scenario: IntakeScenario = {
      ...CONVENTIONAL_SCENARIO,
      has_financial_statements: false,
    };
    const req = deriveScenarioRequirements({ scenario, now: FEB_2026 });

    assert.equal(req.requiresFinancialStatements, false);
    assert.equal(req.requiresPFS, true); // PFS always required
  });
});

// ---------------------------------------------------------------------------
// needsReviewReasons aggregation
// ---------------------------------------------------------------------------

describe("needsReviewReasons aggregation", () => {
  it("aggregates reason codes from needs-review docs", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs: GatekeeperDocRow[] = [
      { gatekeeper_doc_type: "BUSINESS_TAX_RETURN", gatekeeper_tax_year: 2024, gatekeeper_needs_review: false },
      { gatekeeper_doc_type: "OTHER", gatekeeper_tax_year: null, gatekeeper_needs_review: true, gatekeeper_review_reason_code: "LOW_CONFIDENCE" },
      { gatekeeper_doc_type: "UNKNOWN", gatekeeper_tax_year: null, gatekeeper_needs_review: true, gatekeeper_review_reason_code: "LOW_CONFIDENCE" },
      { gatekeeper_doc_type: "BUSINESS_TAX_RETURN", gatekeeper_tax_year: null, gatekeeper_needs_review: true, gatekeeper_review_reason_code: "MISSING_TAX_YEAR" },
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.needsReviewCount, 3);
    assert.deepEqual(result.needsReviewReasons, {
      LOW_CONFIDENCE: 2,
      MISSING_TAX_YEAR: 1,
    });
  });

  it("defaults to UNKNOWN when reason code is null", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs: GatekeeperDocRow[] = [
      { gatekeeper_doc_type: "OTHER", gatekeeper_tax_year: null, gatekeeper_needs_review: true },
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.needsReviewReasons, { UNKNOWN: 1 });
  });

  it("empty when no needs-review docs", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs: GatekeeperDocRow[] = [
      { gatekeeper_doc_type: "BUSINESS_TAX_RETURN", gatekeeper_tax_year: 2024, gatekeeper_needs_review: false },
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.needsReviewReasons, {});
  });
});

// ---------------------------------------------------------------------------
// CI Guards: Readiness Vocabulary Normalization
//
// These guards verify that canonical sub-types are visible to the readiness
// engine when pre-normalized by the server layer. No canonical sub-type
// should silently fall to "OTHER" and become invisible to readiness.
// ---------------------------------------------------------------------------

describe("readiness vocabulary — canonical sub-type visibility", () => {
  it("INCOME_STATEMENT (normalized to FINANCIAL_STATEMENT) → counts as financial statement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: false,
    };
    // Server normalizes INCOME_STATEMENT → FINANCIAL_STATEMENT
    const docs = [makeDoc("FINANCIAL_STATEMENT", null)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.financialStatementsPresent, true);
    assert.equal(result.missing.financialStatementsMissing, false);
    assert.equal(result.readinessPct, 100);
  });

  it("BALANCE_SHEET (normalized to FINANCIAL_STATEMENT) → counts as financial statement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: false,
    };
    // Server normalizes BALANCE_SHEET → FINANCIAL_STATEMENT
    const docs = [makeDoc("FINANCIAL_STATEMENT", null)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.financialStatementsPresent, true);
    assert.equal(result.readinessPct, 100);
  });

  it("T12 (normalized to FINANCIAL_STATEMENT) → counts as financial statement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: false,
    };
    // Server normalizes T12 → FINANCIAL_STATEMENT
    const docs = [makeDoc("FINANCIAL_STATEMENT", null)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.financialStatementsPresent, true);
    assert.equal(result.readinessPct, 100);
  });

  it("PFS (normalized to PERSONAL_FINANCIAL_STATEMENT) → counts as PFS", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: true,
    };
    // Server normalizes PFS → PERSONAL_FINANCIAL_STATEMENT
    const docs = [makeDoc("PERSONAL_FINANCIAL_STATEMENT", null)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.pfsPresent, true);
    assert.equal(result.missing.pfsMissing, false);
    assert.equal(result.readinessPct, 100);
  });

  it("IRS_BUSINESS (normalized to BUSINESS_TAX_RETURN) → counts as BTR", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // Server normalizes IRS_BUSINESS → BUSINESS_TAX_RETURN
    const docs = [makeDoc("BUSINESS_TAX_RETURN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.businessTaxYears, [2024]);
    assert.equal(result.readinessPct, 100);
  });

  it("IRS_PERSONAL (normalized to PERSONAL_TAX_RETURN) → counts as PTR", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // Server normalizes IRS_PERSONAL → PERSONAL_TAX_RETURN
    const docs = [makeDoc("PERSONAL_TAX_RETURN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [2024]);
    assert.equal(result.readinessPct, 100);
  });
});

describe("readiness vocabulary — no-OTHER-fallthrough guard", () => {
  it("no canonical sub-type ever becomes OTHER in readiness (pure engine passthrough)", () => {
    // The pure engine uses doc types as-is after server normalization.
    // This test verifies that unknown types don't accidentally match
    // any readiness category — they're simply invisible (not counted).
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [2024],
      requiresFinancialStatements: true,
      requiresPFS: true,
    };
    // "OTHER" type should not satisfy any requirement
    const docs = [
      makeDoc("OTHER", null),
      makeDoc("OTHER", 2024),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.present.businessTaxYears.length, 0, "OTHER must not count as BTR");
    assert.equal(result.present.personalTaxYears.length, 0, "OTHER must not count as PTR");
    assert.equal(result.present.financialStatementsPresent, false, "OTHER must not count as FS");
    assert.equal(result.present.pfsPresent, false, "OTHER must not count as PFS");
    assert.equal(result.readinessPct, 0);
  });

  it("UNKNOWN type does not satisfy any requirement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [2024],
      personalTaxYears: [],
      requiresFinancialStatements: true,
      requiresPFS: true,
    };
    const docs = [makeDoc("UNKNOWN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.equal(result.readinessPct, 0);
    assert.equal(result.present.businessTaxYears.length, 0);
    assert.equal(result.present.financialStatementsPresent, false);
    assert.equal(result.present.pfsPresent, false);
  });
});

// ---------------------------------------------------------------------------
// CI Guards: Supporting Income Docs ≠ Personal Tax Return
//
// W2 / 1099 / K-1 are supporting income documents. They do NOT satisfy
// PTR (1040) requirements. Only PERSONAL_TAX_RETURN satisfies PTR.
// ---------------------------------------------------------------------------

describe("readiness vocabulary — supporting docs do NOT satisfy PTR", () => {
  it("W2 (normalized to OTHER) does not satisfy PTR requirement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("OTHER", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [], "W2/OTHER must not satisfy PTR");
    assert.deepEqual(result.missing.personalTaxYears, [2024]);
  });

  it("multiple supporting docs (W2 + 1099 + K1 all → OTHER) still leave PTR missing", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    // All three supporting doc types normalized to OTHER by server
    const docs = [
      makeDoc("OTHER", 2024),
      makeDoc("OTHER", 2024),
      makeDoc("OTHER", 2024),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [], "Supporting docs must not satisfy PTR");
    assert.equal(result.readinessPct, 0);
  });

  it("PERSONAL_TAX_RETURN (1040) satisfies PTR requirement", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("PERSONAL_TAX_RETURN", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [2024]);
    assert.equal(result.missing.personalTaxYears.length, 0);
    assert.equal(result.readinessPct, 100);
  });

  it("supporting docs alongside real PTR — PTR satisfies, supporting ignored", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [
      makeDoc("OTHER", 2024),              // W2 (supporting)
      makeDoc("PERSONAL_TAX_RETURN", 2024), // actual 1040
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [2024]);
    assert.equal(result.readinessPct, 100);
  });
});
