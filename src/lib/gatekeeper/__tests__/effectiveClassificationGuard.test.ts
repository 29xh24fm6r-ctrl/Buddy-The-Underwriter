/**
 * Effective Classification Guards — Institutional Non-Regression
 *
 * Ensures the system-wide truth resolver (resolveEffectiveClassification)
 * maintains deterministic COALESCE semantics. No subsystem may bypass
 * this resolver to read raw gatekeeper values for decisions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEffectiveClassification,
  type ClassificationInput,
} from "../resolveEffectiveClassification";
import { mapGatekeeperDocTypeToEffectiveDocType } from "../routing";

describe("effectiveClassificationGuard", () => {
  // Guard 1: canonical_type always wins over gatekeeper_doc_type
  it("guard-1: canonical_type wins over gatekeeper_doc_type", () => {
    const input: ClassificationInput = {
      canonical_type: "PERSONAL_TAX_RETURN",
      gatekeeper_doc_type: "W2",
      gatekeeper_tax_year: 2023,
      doc_year: null,
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.effectiveDocType, "PERSONAL_TAX_RETURN");
    assert.equal(result.source, "CANONICAL");
  });

  // Guard 2: intake_confirmed_at set → isConfirmed === true, source === "CONFIRMED"
  it("guard-2: intake_confirmed_at → isConfirmed + CONFIRMED source", () => {
    const input: ClassificationInput = {
      canonical_type: "BUSINESS_TAX_RETURN",
      gatekeeper_doc_type: "FINANCIAL_STATEMENT",
      doc_year: 2022,
      gatekeeper_tax_year: 2023,
      intake_confirmed_at: "2026-02-15T12:00:00Z",
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.isConfirmed, true);
    assert.equal(result.source, "CONFIRMED");
    assert.equal(result.effectiveDocType, "BUSINESS_TAX_RETURN");
    assert.equal(result.effectiveTaxYear, 2022);
  });

  // Guard 3: all fields null → UNKNOWN type, UNKNOWN source
  it("guard-3: all null → effectiveDocType UNKNOWN, source UNKNOWN", () => {
    const input: ClassificationInput = {
      canonical_type: null,
      document_type: null,
      gatekeeper_doc_type: null,
      ai_doc_type: null,
      doc_year: null,
      gatekeeper_tax_year: null,
      ai_tax_year: null,
      intake_confirmed_at: null,
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.effectiveDocType, "UNKNOWN");
    assert.equal(result.source, "UNKNOWN");
    assert.equal(result.effectiveTaxYear, null);
    assert.equal(result.isConfirmed, false);
  });

  // Guard 4: mapGatekeeperDocTypeToEffectiveDocType is idempotent for canonical types
  it("guard-4: effective type mapping is idempotent for canonical types", () => {
    const canonical = [
      "PERSONAL_TAX_RETURN",
      "BUSINESS_TAX_RETURN",
      "FINANCIAL_STATEMENT",
      "PERSONAL_FINANCIAL_STATEMENT",
    ] as const;

    for (const t of canonical) {
      assert.equal(
        mapGatekeeperDocTypeToEffectiveDocType(t as any),
        t,
        `${t} must map to itself (idempotent)`,
      );
    }
  });

  // Guard 5: confirmed doc overrides gatekeeper type mismatch
  it("guard-5: confirmed doc with canonical_type overrides gatekeeper mismatch", () => {
    // Gatekeeper says W2, human confirmed it as PERSONAL_TAX_RETURN (year 2022)
    const input: ClassificationInput = {
      canonical_type: "PERSONAL_TAX_RETURN",
      gatekeeper_doc_type: "W2",
      doc_year: 2022,
      gatekeeper_tax_year: 2023,
      intake_confirmed_at: "2026-02-15T12:00:00Z",
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.effectiveDocType, "PERSONAL_TAX_RETURN");
    assert.equal(result.effectiveTaxYear, 2022);
    assert.equal(result.source, "CONFIRMED");
    assert.equal(result.isConfirmed, true);
  });

  // Guard 6: gatekeeper_doc_type alone → UNKNOWN (v1.3: removed from type COALESCE)
  it("guard-6: gatekeeper_doc_type alone → UNKNOWN (gatekeeper not a type authority)", () => {
    const input: ClassificationInput = {
      canonical_type: null,
      document_type: null,
      gatekeeper_doc_type: "FINANCIAL_STATEMENT",
      ai_doc_type: null,
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.effectiveDocType, "UNKNOWN");
    assert.equal(result.source, "UNKNOWN");
  });

  // Guard 7: Year COALESCE — doc_year wins over gatekeeper_tax_year wins over ai_tax_year
  it("guard-7: year COALESCE priority — doc_year > gatekeeper_tax_year > ai_tax_year", () => {
    // All three present — doc_year wins
    const r1 = resolveEffectiveClassification({
      doc_year: 2022,
      gatekeeper_tax_year: 2023,
      ai_tax_year: 2024,
    });
    assert.equal(r1.effectiveTaxYear, 2022);

    // doc_year null — gatekeeper_tax_year wins
    const r2 = resolveEffectiveClassification({
      doc_year: null,
      gatekeeper_tax_year: 2023,
      ai_tax_year: 2024,
    });
    assert.equal(r2.effectiveTaxYear, 2023);

    // doc_year + gatekeeper null — ai_tax_year wins
    const r3 = resolveEffectiveClassification({
      doc_year: null,
      gatekeeper_tax_year: null,
      ai_tax_year: 2024,
    });
    assert.equal(r3.effectiveTaxYear, 2024);
  });

  // Guard 8: ai_doc_type wins over gatekeeper_doc_type (v1.3: spine > gatekeeper)
  it("guard-8: ai_doc_type wins over gatekeeper_doc_type (spine authority)", () => {
    const input: ClassificationInput = {
      canonical_type: null,
      document_type: null,
      gatekeeper_doc_type: "FINANCIAL_STATEMENT",
      ai_doc_type: "LEASE_AGREEMENT",
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.effectiveDocType, "LEASE_AGREEMENT");
    assert.equal(result.source, "AI");
  });

  // Guard 9: gatekeeper_tax_year still contributes to year COALESCE (preserved)
  it("guard-9: gatekeeper_tax_year still resolves year (year authority preserved)", () => {
    const input: ClassificationInput = {
      canonical_type: null,
      document_type: null,
      gatekeeper_doc_type: null,
      ai_doc_type: null,
      doc_year: null,
      gatekeeper_tax_year: 2023,
      ai_tax_year: null,
    };
    const result = resolveEffectiveClassification(input);

    assert.equal(result.effectiveTaxYear, 2023);
  });
});
