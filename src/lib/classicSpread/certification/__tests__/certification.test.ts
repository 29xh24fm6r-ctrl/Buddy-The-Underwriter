import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  certifiedDirectFact,
  certifiedDerived,
  certifiedUnavailable,
  certifiedBlocked,
  isRenderable,
} from "../certifiedSpreadValue";
import {
  certifyFactSelection,
  getCertified,
  type CertifiableFact,
} from "../certifyFactSelection";
import { evaluateFormula, FORMULAS } from "../certifiedFormulaEngine";
import { auditRowFromValue, summarizeAudit } from "../certifiedSpreadAudit";

/**
 * SPEC-CLASSIC-SPREAD-CERTIFIED-NUMBER-SOURCES-1 (Phase 1) — the certification framework.
 * A number renders only with a source trace (direct fact / named formula) or is
 * unavailable/blocked. No naked numbers.
 */

function fact(over: Partial<CertifiableFact>): CertifiableFact {
  return {
    id: Math.random().toString(36).slice(2),
    fact_key: "SL_TOTAL_ASSETS",
    fact_value_num: 1_000_000,
    fact_period_end: "2024-12-31",
    owner_type: "DEAL",
    owner_entity_id: null,
    source_document_id: "doc-1",
    source_canonical_type: "BALANCE_SHEET",
    confidence: 0.9,
    extractor: "gemini_primary_v1",
    is_superseded: false,
    resolution_status: "inferred",
    ...over,
  };
}

describe("CertifiedSpreadValue constructors", () => {
  it("direct fact carries the source trace and is renderable", () => {
    const v = certifiedDirectFact(310_134, {
      factId: "f1",
      factKey: "WAGES_W2",
      documentId: "doc-9",
      canonicalType: "PERSONAL_TAX_RETURN",
      confidence: 0.8,
    });
    assert.equal(v.status, "certified");
    assert.equal(v.sourceType, "direct_fact");
    assert.deepEqual(v.sourceFactIds, ["f1"]);
    assert.deepEqual(v.sourceFactKeys, ["WAGES_W2"]);
    assert.equal(v.confidence, 0.8);
    assert.ok(isRenderable(v));
  });

  it("derived value unions input traces and takes the weakest input confidence", () => {
    const a = certifiedDirectFact(100, { factId: "a", factKey: "TCA", documentId: "d1", canonicalType: "BALANCE_SHEET", confidence: 0.9 });
    const b = certifiedDirectFact(40, { factId: "b", factKey: "TCL", documentId: "d2", canonicalType: "BALANCE_SHEET", confidence: 0.7 });
    const v = certifiedDerived(60, "WORKING_CAPITAL", [a, b]);
    assert.equal(v.value, 60);
    assert.equal(v.sourceType, "derived_formula");
    assert.equal(v.formulaName, "WORKING_CAPITAL");
    assert.deepEqual(v.sourceFactIds, ["a", "b"]);
    assert.equal(v.confidence, 0.7);
    assert.ok(isRenderable(v));
  });

  it("unavailable and blocked are not renderable", () => {
    assert.ok(!isRenderable(certifiedUnavailable("missing input")));
    assert.ok(!isRenderable(certifiedBlocked("conflict")));
  });
});

describe("certifyFactSelection — lifecycle + reconciliation", () => {
  it("drops superseded, rejected and system_invalidated facts before reconciliation", () => {
    const sel = certifyFactSelection([
      fact({ id: "ok", fact_value_num: 4_200_000 }),
      fact({ id: "sup", fact_value_num: 9_990_000, is_superseded: true }),
      fact({ id: "rej", fact_value_num: 8_880_000, resolution_status: "rejected" }),
      fact({ id: "inv", fact_value_num: 7_770_000, resolution_status: "system_invalidated" }),
    ]);
    const v = getCertified(sel, "SL_TOTAL_ASSETS", "2024-12-31");
    assert.equal(v?.value, 4_200_000);
    assert.equal(sel.filtered.length, 3);
    assert.deepEqual(
      sel.filtered.map((f) => f.fact.id).sort(),
      ["inv", "rej", "sup"],
    );
  });

  it("an OCR micro-value loses to a stronger same-key/period/owner fact (WAGES_W2 = 3 vs 310,134)", () => {
    const sel = certifyFactSelection([
      fact({ id: "micro", fact_key: "WAGES_W2", fact_value_num: 3, confidence: 0.55, extractor: "personalIncomeExtractor:v2:deterministic", owner_type: "PERSONAL", owner_entity_id: "o1", source_canonical_type: "PERSONAL_TAX_RETURN" }),
      fact({ id: "strong", fact_key: "WAGES_W2", fact_value_num: 310_134, confidence: 0.8, extractor: "gemini_primary_v1", owner_type: "PERSONAL", owner_entity_id: "o1", source_canonical_type: "PERSONAL_TAX_RETURN" }),
    ]);
    const v = getCertified(sel, "WAGES_W2", "2024-12-31", "PERSONAL", "o1");
    assert.equal(v?.value, 310_134);
    assert.ok(sel.rejected.some((r) => r.fact.fact_value_num === 3));
  });

  it("AGI = 0 beside material wages is gated (blocked), not silently certified", () => {
    const sel = certifyFactSelection([
      fact({ fact_key: "WAGES_W2", fact_value_num: 310_134, owner_type: "PERSONAL", owner_entity_id: "o1" }),
      fact({ fact_key: "ADJUSTED_GROSS_INCOME", fact_value_num: 0, owner_type: "PERSONAL", owner_entity_id: "o1" }),
    ]);
    assert.equal(getCertified(sel, "ADJUSTED_GROSS_INCOME", "2024-12-31", "PERSONAL", "o1"), null);
    assert.equal(sel.blocked, true);
  });
});

describe("certifiedFormulaEngine — required / zero-safe / blocked semantics", () => {
  const tca = certifiedDirectFact(500, { factId: "a", factKey: "TOTAL_CURRENT_ASSETS", documentId: "d", canonicalType: "BALANCE_SHEET", confidence: 0.9 });
  const tcl = certifiedDirectFact(200, { factId: "b", factKey: "TOTAL_CURRENT_LIABILITIES", documentId: "d", canonicalType: "BALANCE_SHEET", confidence: 0.9 });

  it("all inputs certified → certified derived value with trace + formulaName", () => {
    const v = evaluateFormula(FORMULAS.WORKING_CAPITAL, { totalCurrentAssets: tca, totalCurrentLiabilities: tcl });
    assert.equal(v.status, "certified");
    assert.equal(v.value, 300);
    assert.equal(v.formulaName, "WORKING_CAPITAL");
    assert.deepEqual(v.sourceFactIds, ["a", "b"]);
  });

  it("missing REQUIRED input → unavailable (never zero)", () => {
    const v = evaluateFormula(FORMULAS.WORKING_CAPITAL, { totalCurrentAssets: tca, totalCurrentLiabilities: undefined });
    assert.equal(v.status, "unavailable");
    assert.equal(v.value, null);
    assert.match(v.failureReason ?? "", /totalCurrentLiabilities/);
  });

  it("missing ZERO-SAFE input contributes 0 and stays certified", () => {
    const ppe = certifiedDirectFact(1000, { factId: "p", factKey: "SL_PPE_GROSS", documentId: "d", canonicalType: "BALANCE_SHEET", confidence: 0.9 });
    const v = evaluateFormula(FORMULAS.NET_FIXED_ASSETS, { ppeGross: ppe, accumulatedDepreciation: undefined });
    assert.equal(v.status, "certified");
    assert.equal(v.value, 1000);
  });

  it("a blocked input propagates (result blocked), never zero-safed away", () => {
    const blockedDep = certifiedBlocked("accum depreciation conflict");
    const ppe = certifiedDirectFact(1000, { factId: "p", factKey: "SL_PPE_GROSS", documentId: "d", canonicalType: "BALANCE_SHEET", confidence: 0.9 });
    const v = evaluateFormula(FORMULAS.NET_FIXED_ASSETS, { ppeGross: ppe, accumulatedDepreciation: blockedDep });
    assert.equal(v.status, "blocked");
    assert.equal(v.value, null);
  });
});

describe("certifiedSpreadAudit — per-value audit + summary", () => {
  const certified = certifiedDirectFact(100, { factId: "f1", factKey: "SL_CASH", documentId: "d1", canonicalType: "BALANCE_SHEET", confidence: 0.9 });
  const unavailable = certifiedUnavailable("required input missing");
  const blocked = certifiedBlocked("liabilities conflict");

  it("audit row maps status → pass and only shows a number when certified", () => {
    const ok = auditRowFromValue("balance_sheet", "Cash", "2024-12-31", certified);
    assert.equal(ok.pass, true);
    assert.equal(ok.displayedValue, 100);

    const bad = auditRowFromValue("balance_sheet", "Total Liabilities", "2024-12-31", blocked);
    assert.equal(bad.pass, false);
    assert.equal(bad.displayedValue, null);
    assert.match(bad.failureReason ?? "", /conflict/);
  });

  it("summary counts blocked/unavailable and computes certificationStatus", () => {
    const rows = [
      auditRowFromValue("p", "a", "2024-12-31", certified),
      auditRowFromValue("p", "b", "2024-12-31", unavailable),
      auditRowFromValue("p", "c", "2024-12-31", blocked),
    ];
    const sum = summarizeAudit(rows, ["verify before committee"]);
    assert.equal(sum.blockedValueCount, 1);
    assert.equal(sum.unavailableValueCount, 1);
    assert.equal(sum.sourceFactCount, 1);
    assert.equal(sum.certificationStatus, "blocked"); // a blocked value dominates
  });

  it("clean summary when every value is certified and no caveats", () => {
    const rows = [auditRowFromValue("p", "a", "2024-12-31", certified)];
    assert.equal(summarizeAudit(rows).certificationStatus, "clean");
  });
});
