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

  it("W2 counts as PERSONAL_TAX_RETURN — satisfies personal year 2024", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [makeDoc("W2", 2024)];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears, [2024]);
    assert.equal(result.readinessPct, 100);
  });

  it("FORM_1099 and K1 map to PERSONAL_TAX_RETURN effective type", () => {
    const req: ScenarioRequirements = {
      businessTaxYears: [],
      personalTaxYears: [2024, 2023],
      requiresFinancialStatements: false,
      requiresPFS: false,
    };
    const docs = [
      makeDoc("FORM_1099", 2024),
      makeDoc("K1", 2023),
    ];
    const result = computeGatekeeperReadiness({ requirements: req, documents: docs });

    assert.deepEqual(result.present.personalTaxYears.sort(), [2023, 2024]);
    assert.equal(result.readinessPct, 100);
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
