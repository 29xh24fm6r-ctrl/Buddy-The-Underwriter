/**
 * SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 Layer 2 — form-agnostic
 * SL_TOTAL_LIABILITIES reconciliation. Form-variant matrix + safety guards.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileTotalLiabilities } from "../totalLiabilitiesReconciliation";
import type { ExtractedLineItem } from "../shared";

const prov = { source_type: "DOC_EXTRACT" as const, source_ref: "deal_documents:test", as_of_date: null };

function item(factKey: string, value: number, periodEnd = "2022-12-31"): ExtractedLineItem {
  return { factKey, value, confidence: 0.8, periodStart: null, periodEnd, provenance: prov };
}

function total(items: ExtractedLineItem[], periodEnd = "2022-12-31"): number | undefined {
  return items.find((i) => i.factKey === "SL_TOTAL_LIABILITIES" && i.periodEnd === periodEnd)?.value;
}

describe("reconcileTotalLiabilities", () => {
  it("1120 C-corp: overrides the line-28 (Total L&E == Total Assets) capture with the component sum", () => {
    // OmniCare 2022: extractor grabbed line 28 (3,268,740 == Total Assets).
    const items = [
      item("SL_TOTAL_ASSETS", 3268740),
      item("SL_TOTAL_LIABILITIES", 3268740), // wrong (line 28)
      item("SL_OPERATING_CURRENT_LIABILITIES", 24884),
      item("SL_LOANS_FROM_SHAREHOLDERS", 1503500),
    ];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out), 1528384, "OCL + shareholder loans");
  });

  it("sums genuinely distinct debt lines (loans ≠ mortgages)", () => {
    const items = [
      item("SL_ACCOUNTS_PAYABLE", 71364),
      item("SL_LOANS_FROM_SHAREHOLDERS", 200000),
      item("SL_MORTGAGES_NOTES_BONDS", 1730705),
      // no SL_TOTAL_LIABILITIES extracted → synthesized
    ];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out), 71364 + 200000 + 1730705);
  });

  it("de-dupes the same loan reported on Schedule L lines 19 and 20 (loans == mortgages)", () => {
    // OmniCare 2023: both lines carry $1,730,705 — one loan, counted once.
    const items = [
      item("SL_ACCOUNTS_PAYABLE", 31669, "2023-12-31"),
      item("SL_OPERATING_CURRENT_LIABILITIES", 10669, "2023-12-31"),
      item("SL_LOANS_FROM_SHAREHOLDERS", 1730705, "2023-12-31"),
      item("SL_MORTGAGES_NOTES_BONDS", 1730705, "2023-12-31"),
    ];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out, "2023-12-31"), 1773043, "31,669 + 10,669 + 1,730,705 (deduped)");
  });

  it("leaves SL_TOTAL_LIABILITIES untouched when no component facts exist", () => {
    const items = [item("SL_TOTAL_LIABILITIES", 999999), item("SL_TOTAL_ASSETS", 999999)];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out), 999999);
  });

  it("does NOT clobber a correct extracted total that is not the line-28 bug (partial components)", () => {
    // QuickBooks BS: real total 140,450.71 (≠ Total Assets 3,342,585.66). Only
    // one component present — recomputing would UNDERCOUNT, so leave it alone.
    const items = [
      item("SL_TOTAL_ASSETS", 3342585.66, "2025-12-31"),
      item("SL_TOTAL_LIABILITIES", 140450.71, "2025-12-31"),
      item("SL_ACCOUNTS_PAYABLE", 102336.14, "2025-12-31"),
    ];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out, "2025-12-31"), 140450.71, "correct total preserved");
  });

  it("is idempotent when the extracted total already equals the component sum", () => {
    const items = [
      item("SL_TOTAL_ASSETS", 3342585.66, "2025-12-31"),
      item("SL_TOTAL_LIABILITIES", 140450.71, "2025-12-31"),
      item("SL_ACCOUNTS_PAYABLE", 102336.14, "2025-12-31"),
      item("SL_OPERATING_CURRENT_LIABILITIES", 38114.57, "2025-12-31"),
    ];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out, "2025-12-31"), 140450.71);
    // No duplicate SL_TOTAL_LIABILITIES row created.
    assert.equal(out.filter((i) => i.factKey === "SL_TOTAL_LIABILITIES").length, 1);
  });

  it("reconciles each period independently within one document", () => {
    const items = [
      item("SL_TOTAL_ASSETS", 3268740, "2022-12-31"),
      item("SL_TOTAL_LIABILITIES", 3268740, "2022-12-31"),
      item("SL_OPERATING_CURRENT_LIABILITIES", 24884, "2022-12-31"),
      item("SL_LOANS_FROM_SHAREHOLDERS", 1503500, "2022-12-31"),
      item("SL_ACCOUNTS_PAYABLE", 31669, "2023-12-31"),
      item("SL_OPERATING_CURRENT_LIABILITIES", 10669, "2023-12-31"),
      item("SL_LOANS_FROM_SHAREHOLDERS", 1730705, "2023-12-31"),
      item("SL_MORTGAGES_NOTES_BONDS", 1730705, "2023-12-31"),
    ];
    const out = reconcileTotalLiabilities(items);
    assert.equal(total(out, "2022-12-31"), 1528384);
    assert.equal(total(out, "2023-12-31"), 1773043);
  });

  it("does not mutate the input array", () => {
    const items = [
      item("SL_TOTAL_ASSETS", 3268740),
      item("SL_TOTAL_LIABILITIES", 3268740),
      item("SL_LOANS_FROM_SHAREHOLDERS", 1503500),
    ];
    reconcileTotalLiabilities(items);
    assert.equal(total(items), 3268740, "original untouched");
  });
});
