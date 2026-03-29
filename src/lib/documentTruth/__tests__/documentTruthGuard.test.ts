import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  REQUIREMENT_REGISTRY,
  lookupRequirement,
  getRequirementsForDealType,
} from "../requirementRegistry";
import { matchDocumentToRequirement } from "../matchDocumentToRequirement";

// ─── Requirement Registry tests ───────────────────────────────────────────────

describe("RequirementRegistry", () => {
  it("has at least 13 requirements", () => {
    assert.ok(REQUIREMENT_REGISTRY.length >= 13);
  });

  it("every requirement has a code, label, and group", () => {
    for (const r of REQUIREMENT_REGISTRY) {
      assert.ok(r.code.length > 0, `Empty code`);
      assert.ok(r.label.length > 0, `Empty label for ${r.code}`);
      assert.ok(r.group.length > 0, `Empty group for ${r.code}`);
    }
  });

  it("no duplicate codes", () => {
    const codes = REQUIREMENT_REGISTRY.map((r) => r.code);
    assert.equal(codes.length, new Set(codes).size);
  });

  it("lookupRequirement finds known codes", () => {
    assert.ok(lookupRequirement("financials.business_tax_returns"));
    assert.ok(lookupRequirement("collateral.appraisal"));
  });

  it("lookupRequirement returns undefined for unknown codes", () => {
    assert.equal(lookupRequirement("nonexistent.code"), undefined);
  });

  it("getRequirementsForDealType returns all-type requirements", () => {
    const conventional = getRequirementsForDealType("conventional");
    assert.ok(conventional.some((r) => r.code === "financials.business_tax_returns"));
  });

  it("getRequirementsForDealType includes CRE-specific for cre", () => {
    const cre = getRequirementsForDealType("cre");
    assert.ok(cre.some((r) => r.code === "property.rent_roll"));
  });

  it("getRequirementsForDealType excludes CRE-specific for conventional", () => {
    const conventional = getRequirementsForDealType("conventional");
    assert.ok(!conventional.some((r) => r.code === "property.rent_roll"));
  });

  it("business tax returns require 3 consecutive years", () => {
    const btr = lookupRequirement("financials.business_tax_returns");
    assert.ok(btr);
    assert.equal(btr.requiredCount, 3);
    assert.equal(btr.yearRule, "consecutive");
    assert.equal(btr.yearCount, 3);
  });
});

// ─── Document Matcher tests ──────────────────────────────────────────────────

describe("matchDocumentToRequirement", () => {
  it("unclassified document returns null requirement", () => {
    const result = matchDocumentToRequirement({
      classifiedType: null,
      partyScope: "business",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.requirementCode, null);
    assert.equal(result.checklistStatus, "missing");
  });

  it("unknown type returns null requirement", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "UNKNOWN_WEIRD_TYPE",
      partyScope: "business",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.requirementCode, null);
  });

  it("IRS_BUSINESS maps to business_tax_returns", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "IRS_BUSINESS",
      year: 2024,
      partyScope: "business",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.requirementCode, "financials.business_tax_returns");
    assert.equal(result.checklistStatus, "received");
  });

  it("business tax return without year is invalid", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "IRS_BUSINESS",
      year: null,
      partyScope: "business",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.validationStatus, "invalid");
    assert.ok(result.reasons.some((r) => r.includes("missing year")));
  });

  it("personal tax return without subject_id is invalid", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "IRS_PERSONAL",
      year: 2024,
      subjectId: null,
      partyScope: "guarantor",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.validationStatus, "invalid");
    assert.ok(result.reasons.some((r) => r.includes("guarantor")));
  });

  it("confirmed + valid = satisfied", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "BALANCE_SHEET",
      partyScope: "business",
      reviewStatus: "confirmed",
    });
    assert.equal(result.requirementCode, "financials.current_balance_sheet");
    assert.equal(result.checklistStatus, "satisfied");
    assert.equal(result.validationStatus, "valid");
    assert.equal(result.readinessStatus, "complete");
  });

  it("PFS maps to personal_financial_statement", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "PFS",
      partyScope: "business",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.requirementCode, "financials.personal_financial_statement");
  });

  it("RENT_ROLL maps to property.rent_roll", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "RENT_ROLL",
      partyScope: "property",
      reviewStatus: "unreviewed",
    });
    assert.equal(result.requirementCode, "property.rent_roll");
  });

  it("INCOME_STATEMENT maps to ytd_income_statement", () => {
    const result = matchDocumentToRequirement({
      classifiedType: "INCOME_STATEMENT",
      partyScope: "business",
      reviewStatus: "confirmed",
    });
    assert.equal(result.requirementCode, "financials.ytd_income_statement");
    assert.equal(result.checklistStatus, "satisfied");
  });

  it("deterministic for same input", () => {
    const input = {
      classifiedType: "IRS_BUSINESS" as const,
      year: 2023,
      partyScope: "business" as const,
      reviewStatus: "confirmed" as const,
    };
    const r1 = matchDocumentToRequirement(input);
    const r2 = matchDocumentToRequirement(input);
    assert.deepEqual(r1, r2);
  });
});

// ─── Status taxonomy tests ────────────────────────────────────────────────────

describe("Status taxonomy enforcement", () => {
  it("uploaded ≠ classified ≠ confirmed ≠ validated ≠ satisfied ≠ ready", () => {
    // These are distinct states in the matcher output
    const received = matchDocumentToRequirement({
      classifiedType: "IRS_BUSINESS",
      year: 2024,
      partyScope: "business",
      reviewStatus: "unreviewed",
    });
    assert.equal(received.checklistStatus, "received"); // uploaded + classified
    assert.equal(received.validationStatus, "pending"); // not yet validated

    const confirmed = matchDocumentToRequirement({
      classifiedType: "IRS_BUSINESS",
      year: 2024,
      partyScope: "business",
      reviewStatus: "confirmed",
    });
    assert.equal(confirmed.checklistStatus, "satisfied"); // confirmed + valid
    assert.equal(confirmed.validationStatus, "valid");
    assert.equal(confirmed.readinessStatus, "complete"); // ready
  });
});

// ─── Pure file guards ─────────────────────────────────────────────────────────

describe("Document truth pure file guards", () => {
  const DIR = path.resolve(__dirname, "..");
  const PURE_FILES = [
    "requirementRegistry.ts",
    "matchDocumentToRequirement.ts",
  ];

  it("no DB imports in pure files", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("supabaseAdmin"), `${f} must not import supabaseAdmin`);
    }
  });

  it("no Math.random", () => {
    for (const f of PURE_FILES) {
      const content = fs.readFileSync(path.join(DIR, f), "utf-8");
      assert.ok(!content.includes("Math.random"), `${f} must not use Math.random`);
    }
  });

  it("matchDocumentToRequirement is the ONLY matcher", () => {
    // Verify the function exists and is exported
    const content = fs.readFileSync(path.join(DIR, "matchDocumentToRequirement.ts"), "utf-8");
    assert.ok(content.includes("export function matchDocumentToRequirement"));
    assert.ok(content.includes("THE ONLY matcher"));
  });
});

// ─── Deal creation route guards ───────────────────────────────────────────────

describe("Deal creation route guards", () => {
  const routePath = path.resolve(__dirname, "../../../app/api/deals/create/route.ts");

  it("deal creation route exists", () => {
    assert.ok(fs.existsSync(routePath));
  });

  it("enforces borrower before deal", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    assert.ok(content.includes("borrower_id"), "Route must handle borrower_id");
    assert.ok(content.includes("borrower_not_found"), "Route must validate borrower exists");
  });

  it("rejects NEEDS NAME", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    assert.ok(content.includes("NEEDS NAME"), "Route must reject NEEDS NAME");
  });

  it("creates audit log", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    assert.ok(content.includes("deal_audit_log"), "Route must write audit log");
    assert.ok(content.includes("deal_created"), "Route must log deal_created event");
  });

  it("no test-id references", () => {
    const content = fs.readFileSync(routePath, "utf-8");
    assert.ok(!content.includes("test-id"), "Route must not reference test-id");
  });
});
