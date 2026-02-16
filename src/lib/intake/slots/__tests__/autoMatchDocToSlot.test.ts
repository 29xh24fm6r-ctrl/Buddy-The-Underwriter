import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Test the matching logic via mapGatekeeperDocTypeToEffectiveDocType
// (already tested in routing.test.ts, but we verify the slot-relevant subset)
// ---------------------------------------------------------------------------

import { mapGatekeeperDocTypeToEffectiveDocType } from "@/lib/gatekeeper/routing";

describe("autoMatchDocToSlot — effective type mapping for slots", () => {
  it("BUSINESS_TAX_RETURN maps to BUSINESS_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("BUSINESS_TAX_RETURN"),
      "BUSINESS_TAX_RETURN",
    );
  });

  it("PERSONAL_TAX_RETURN maps to PERSONAL_TAX_RETURN", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("PERSONAL_TAX_RETURN"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("W2 maps to PERSONAL_TAX_RETURN (fills PTR slots)", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("W2"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("K1 maps to PERSONAL_TAX_RETURN (fills PTR slots)", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("K1"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("FORM_1099 maps to PERSONAL_TAX_RETURN (fills PTR slots)", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("FORM_1099"),
      "PERSONAL_TAX_RETURN",
    );
  });

  it("PERSONAL_FINANCIAL_STATEMENT maps to PERSONAL_FINANCIAL_STATEMENT", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("PERSONAL_FINANCIAL_STATEMENT"),
      "PERSONAL_FINANCIAL_STATEMENT",
    );
  });

  it("FINANCIAL_STATEMENT maps to FINANCIAL_STATEMENT", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("FINANCIAL_STATEMENT"),
      "FINANCIAL_STATEMENT",
    );
  });

  it("UNKNOWN maps to OTHER (not matchable to any slot)", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("UNKNOWN"),
      "OTHER",
    );
  });

  it("DRIVERS_LICENSE maps to ENTITY_DOCS (no matching slot type)", () => {
    assert.equal(
      mapGatekeeperDocTypeToEffectiveDocType("DRIVERS_LICENSE"),
      "ENTITY_DOCS",
    );
  });
});

// ---------------------------------------------------------------------------
// Test slot matching rules (unit logic)
// ---------------------------------------------------------------------------

describe("autoMatchDocToSlot — slot matching rules", () => {
  // Simulate the matching logic from autoMatchByEffectiveType
  function findBestSlot(
    effectiveType: string,
    taxYear: number | null,
    slots: Array<{
      id: string;
      required_doc_type: string;
      required_tax_year: number | null;
      sort_order: number;
    }>,
  ): string | null {
    // Replicate effectiveTypeToSlotDocTypes logic (with classifier aliases)
    let slotDocTypes: string[];
    switch (effectiveType) {
      case "IRS_BUSINESS":
      case "BUSINESS_TAX_RETURN":
        slotDocTypes = ["BUSINESS_TAX_RETURN"];
        break;
      case "IRS_PERSONAL":
      case "PERSONAL_TAX_RETURN":
        slotDocTypes = ["PERSONAL_TAX_RETURN"];
        break;
      case "PFS":
      case "PERSONAL_FINANCIAL_STATEMENT":
        slotDocTypes = ["PERSONAL_FINANCIAL_STATEMENT"];
        break;
      case "T12":
      case "INCOME_STATEMENT":
        slotDocTypes = ["INCOME_STATEMENT"];
        break;
      case "BALANCE_SHEET":
        slotDocTypes = ["BALANCE_SHEET"];
        break;
      case "FINANCIAL_STATEMENT":
        slotDocTypes = ["BALANCE_SHEET", "INCOME_STATEMENT"];
        break;
      default:
        return null;
    }

    const candidates = slots
      .filter((s) => slotDocTypes.includes(s.required_doc_type))
      .sort((a, b) => a.sort_order - b.sort_order);

    if (candidates.length === 0) return null;

    const yearBased =
      effectiveType === "BUSINESS_TAX_RETURN" ||
      effectiveType === "IRS_BUSINESS" ||
      effectiveType === "PERSONAL_TAX_RETURN" ||
      effectiveType === "IRS_PERSONAL";

    if (yearBased && taxYear != null) {
      return candidates.find((s) => s.required_tax_year === taxYear)?.id ?? null;
    }

    return candidates[0]?.id ?? null;
  }

  it("BTR 2024 matches BUSINESS_TAX_RETURN_2024 slot", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s2", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
      { id: "s3", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2022, sort_order: 2 },
    ];
    assert.equal(findBestSlot("BUSINESS_TAX_RETURN", 2024, slots), "s1");
  });

  it("BTR 2023 matches BUSINESS_TAX_RETURN_2023 slot (not 2024)", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s2", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("BUSINESS_TAX_RETURN", 2023, slots), "s2");
  });

  it("PTR 2024 matches PERSONAL_TAX_RETURN_2024 slot", () => {
    const slots = [
      { id: "s4", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2024, sort_order: 3 },
      { id: "s5", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2023, sort_order: 4 },
    ];
    assert.equal(findBestSlot("PERSONAL_TAX_RETURN", 2024, slots), "s4");
  });

  it("W2 effective type PERSONAL_TAX_RETURN matches PTR slot", () => {
    const effective = mapGatekeeperDocTypeToEffectiveDocType("W2");
    const slots = [
      { id: "s4", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2023, sort_order: 0 },
    ];
    assert.equal(findBestSlot(effective, 2023, slots), "s4");
  });

  it("PFS matches PFS_CURRENT slot (no year required)", () => {
    const slots = [
      { id: "s7", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT", required_tax_year: null, sort_order: 6 },
    ];
    assert.equal(findBestSlot("PERSONAL_FINANCIAL_STATEMENT", null, slots), "s7");
  });

  it("FINANCIAL_STATEMENT matches INCOME_STATEMENT slot (first empty by sort_order)", () => {
    const slots = [
      { id: "s9", required_doc_type: "BALANCE_SHEET", required_tax_year: null, sort_order: 8 },
      { id: "s8", required_doc_type: "INCOME_STATEMENT", required_tax_year: null, sort_order: 7 },
    ];
    // sort_order 7 < 8, so INCOME_STATEMENT first
    assert.equal(findBestSlot("FINANCIAL_STATEMENT", null, slots), "s8");
  });

  it("BTR with null tax_year falls through to first candidate", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
    ];
    // Year-based type with null year: falls to candidates[0]
    assert.equal(findBestSlot("BUSINESS_TAX_RETURN", null, slots), "s1");
  });

  it("no matching slot doc type → null", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
    ];
    assert.equal(findBestSlot("PERSONAL_FINANCIAL_STATEMENT", null, slots), null);
  });

  it("empty slots array → null", () => {
    assert.equal(findBestSlot("BUSINESS_TAX_RETURN", 2024, []), null);
  });

  it("BTR 2021 with no 2021 slot → null (year mismatch)", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s2", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("BUSINESS_TAX_RETURN", 2021, slots), null);
  });

  it("UNKNOWN effective type OTHER → null (no slot types)", () => {
    assert.equal(findBestSlot("OTHER", null, []), null);
  });

  it("ENTITY_DOCS → null (no slot types)", () => {
    assert.equal(findBestSlot("ENTITY_DOCS", null, []), null);
  });

  // --- Classifier raw type aliases ---

  it("IRS_BUSINESS + year 2024 matches BTR 2024 slot", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s2", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("IRS_BUSINESS", 2024, slots), "s1");
  });

  it("IRS_PERSONAL + year 2023 matches PTR 2023 slot", () => {
    const slots = [
      { id: "s4", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s5", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("IRS_PERSONAL", 2023, slots), "s5");
  });

  it("PFS matches PERSONAL_FINANCIAL_STATEMENT slot", () => {
    const slots = [
      { id: "s7", required_doc_type: "PERSONAL_FINANCIAL_STATEMENT", required_tax_year: null, sort_order: 6 },
    ];
    assert.equal(findBestSlot("PFS", null, slots), "s7");
  });

  it("T12 matches INCOME_STATEMENT slot (NOT BALANCE_SHEET)", () => {
    const slots = [
      { id: "s8", required_doc_type: "INCOME_STATEMENT", required_tax_year: null, sort_order: 7 },
      { id: "s9", required_doc_type: "BALANCE_SHEET", required_tax_year: null, sort_order: 8 },
    ];
    assert.equal(findBestSlot("T12", null, slots), "s8");
  });

  it("IRS_BUSINESS + year 2021 → null (no matching year)", () => {
    const slots = [
      { id: "s1", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s2", required_doc_type: "BUSINESS_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("IRS_BUSINESS", 2021, slots), null);
  });

  it("IRS_PERSONAL + null year → first PTR candidate", () => {
    const slots = [
      { id: "s4", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s5", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("IRS_PERSONAL", null, slots), "s4");
  });
});

// ---------------------------------------------------------------------------
// Test direct INCOME_STATEMENT / BALANCE_SHEET mapping (Phase 2A additions)
// ---------------------------------------------------------------------------

describe("autoMatchDocToSlot — direct IS/BS effective type mapping", () => {
  function findBestSlot(
    effectiveType: string,
    taxYear: number | null,
    slots: Array<{
      id: string;
      required_doc_type: string;
      required_tax_year: number | null;
      sort_order: number;
    }>,
  ): string | null {
    let slotDocTypes: string[];
    switch (effectiveType) {
      case "IRS_BUSINESS":
      case "BUSINESS_TAX_RETURN":
        slotDocTypes = ["BUSINESS_TAX_RETURN"];
        break;
      case "IRS_PERSONAL":
      case "PERSONAL_TAX_RETURN":
        slotDocTypes = ["PERSONAL_TAX_RETURN"];
        break;
      case "PFS":
      case "PERSONAL_FINANCIAL_STATEMENT":
        slotDocTypes = ["PERSONAL_FINANCIAL_STATEMENT"];
        break;
      case "T12":
      case "INCOME_STATEMENT":
        slotDocTypes = ["INCOME_STATEMENT"];
        break;
      case "BALANCE_SHEET":
        slotDocTypes = ["BALANCE_SHEET"];
        break;
      case "FINANCIAL_STATEMENT":
        slotDocTypes = ["BALANCE_SHEET", "INCOME_STATEMENT"];
        break;
      default:
        return null;
    }

    const candidates = slots
      .filter((s) => slotDocTypes.includes(s.required_doc_type))
      .sort((a, b) => a.sort_order - b.sort_order);

    if (candidates.length === 0) return null;

    const yearBased =
      effectiveType === "BUSINESS_TAX_RETURN" ||
      effectiveType === "IRS_BUSINESS" ||
      effectiveType === "PERSONAL_TAX_RETURN" ||
      effectiveType === "IRS_PERSONAL";

    if (yearBased && taxYear != null) {
      return candidates.find((s) => s.required_tax_year === taxYear)?.id ?? null;
    }

    return candidates[0]?.id ?? null;
  }

  it("INCOME_STATEMENT matches INCOME_STATEMENT slot directly", () => {
    const slots = [
      { id: "s8", required_doc_type: "INCOME_STATEMENT", required_tax_year: null, sort_order: 7 },
      { id: "s9", required_doc_type: "BALANCE_SHEET", required_tax_year: null, sort_order: 8 },
    ];
    assert.equal(findBestSlot("INCOME_STATEMENT", null, slots), "s8");
  });

  it("BALANCE_SHEET matches BALANCE_SHEET slot directly", () => {
    const slots = [
      { id: "s8", required_doc_type: "INCOME_STATEMENT", required_tax_year: null, sort_order: 7 },
      { id: "s9", required_doc_type: "BALANCE_SHEET", required_tax_year: null, sort_order: 8 },
    ];
    assert.equal(findBestSlot("BALANCE_SHEET", null, slots), "s9");
  });

  it("INCOME_STATEMENT does not match BALANCE_SHEET slot", () => {
    const slots = [
      { id: "s9", required_doc_type: "BALANCE_SHEET", required_tax_year: null, sort_order: 8 },
    ];
    assert.equal(findBestSlot("INCOME_STATEMENT", null, slots), null);
  });

  it("BALANCE_SHEET does not match INCOME_STATEMENT slot", () => {
    const slots = [
      { id: "s8", required_doc_type: "INCOME_STATEMENT", required_tax_year: null, sort_order: 7 },
    ];
    assert.equal(findBestSlot("BALANCE_SHEET", null, slots), null);
  });

  it("idempotency: second call on already-empty slots returns same result", () => {
    const slots = [
      { id: "s8", required_doc_type: "INCOME_STATEMENT", required_tax_year: null, sort_order: 7 },
    ];
    const first = findBestSlot("INCOME_STATEMENT", null, slots);
    const second = findBestSlot("INCOME_STATEMENT", null, slots);
    assert.equal(first, second);
    assert.equal(first, "s8");
  });

  it("PTR with year mismatch returns null", () => {
    const slots = [
      { id: "s4", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
      { id: "s5", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2023, sort_order: 1 },
    ];
    assert.equal(findBestSlot("PERSONAL_TAX_RETURN", 2020, slots), null);
  });

  it("PTR with null year still matches first candidate (non-strict)", () => {
    const slots = [
      { id: "s4", required_doc_type: "PERSONAL_TAX_RETURN", required_tax_year: 2024, sort_order: 0 },
    ];
    assert.equal(findBestSlot("PERSONAL_TAX_RETURN", null, slots), "s4");
  });
});
