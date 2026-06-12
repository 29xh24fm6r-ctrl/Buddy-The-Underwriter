import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { certifyFactSelection, type CertifiableFact } from "../certifyFactSelection";
import { certifyBalanceSheet } from "../certifiedBalanceSheet";

/**
 * SPEC-CLASSIC-SPREAD-BALANCE-SHEET-ACCOUNTING-GATES-1 (Phase 2) — a balance sheet whose
 * Total Liabilities contradicts its present liability components is BLOCKED, never rendered
 * as a certified zero.
 */

const PERIOD = "2024-12-31";

function f(over: Partial<CertifiableFact>): CertifiableFact {
  return {
    id: Math.random().toString(36).slice(2),
    fact_key: "SL_TOTAL_ASSETS",
    fact_value_num: 1_000_000,
    fact_period_end: PERIOD,
    owner_type: "DEAL",
    owner_entity_id: null,
    source_document_id: "doc-bs",
    source_canonical_type: "BUSINESS_TAX_RETURN",
    confidence: 0.8,
    extractor: "gemini_primary_v1",
    is_superseded: false,
    resolution_status: "inferred",
    ...over,
  };
}

/** The real OmniCare 2024 balance-sheet facts (subset that drives the totals). */
function omniCare2024(extra: CertifiableFact[] = []): CertifiableFact[] {
  return [
    f({ fact_key: "SL_TOTAL_ASSETS", fact_value_num: 6_800_000 }),
    f({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 6_800_000 }),
    f({ fact_key: "SL_RETAINED_EARNINGS", fact_value_num: 4_512_938 }),
    f({ fact_key: "SL_ACCOUNTS_PAYABLE", fact_value_num: 71_364 }),
    f({ fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 1_930_705, confidence: 1, extractor: "taxReturnExtractor:v2:deterministic" }),
    f({ fact_key: "SL_OTHER_LIABILITIES", fact_value_num: 284_993, confidence: 1, extractor: "taxReturnExtractor:v2:deterministic" }),
    ...extra,
  ];
}

describe("certifyBalanceSheet — liability/equity conflict gates", () => {
  it("OmniCare 2024: derived Total Liabilities = 0 is BLOCKED while components are present", () => {
    const sel = certifyFactSelection(omniCare2024());
    const bs = certifyBalanceSheet(sel, PERIOD);
    assert.equal(bs.totalLiabilities.status, "blocked");
    assert.equal(bs.totalLiabilities.value, null);
    assert.match(bs.totalLiabilities.failureReason ?? "", /conflicts with present liability components/);
    // components total to 2,287,062 and are carried in the trace
    assert.equal(bs.liabilityComponents.reduce((a, c) => a + (c.value.value as number), 0), 2_287_062);
    // identity cannot be certified once liabilities are blocked
    assert.equal(bs.identity.status, "blocked");
  });

  it("source trace is preserved on the blocked total (component fact ids + keys)", () => {
    const sel = certifyFactSelection(omniCare2024());
    const bs = certifyBalanceSheet(sel, PERIOD);
    assert.ok(bs.totalLiabilities.sourceFactKeys.includes("SL_ACCOUNTS_PAYABLE"));
    assert.ok(bs.totalLiabilities.sourceFactKeys.includes("SL_LOANS_FROM_SHAREHOLDERS"));
    assert.ok(bs.totalLiabilities.sourceFactIds.length >= 3);
    const auditRow = bs.auditRows.find((r) => r.row === "TOTAL LIABILITIES");
    assert.equal(auditRow?.pass, false);
    assert.equal(auditRow?.displayedValue, null);
    assert.ok((auditRow?.sourceFactKeys.length ?? 0) > 0);
  });

  it("true zero allowed: no material liability components → derived 0 is certified", () => {
    const sel = certifyFactSelection([
      f({ fact_key: "SL_TOTAL_ASSETS", fact_value_num: 500_000 }),
      f({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 500_000 }),
      // no liability components present
    ]);
    const bs = certifyBalanceSheet(sel, PERIOD);
    assert.equal(bs.totalLiabilities.status, "certified");
    assert.equal(bs.totalLiabilities.value, 0);
    assert.equal(bs.totalLiabilities.formulaName, "TOTAL_LIABILITIES_FROM_ASSETS_EQUITY");
    assert.equal(bs.identity.status, "ok");
  });

  it("derived liabilities that RECONCILE with components are certified", () => {
    const sel = certifyFactSelection([
      f({ fact_key: "SL_TOTAL_ASSETS", fact_value_num: 6_800_000 }),
      f({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 4_512_938 }), // correct equity
      f({ fact_key: "SL_ACCOUNTS_PAYABLE", fact_value_num: 71_364 }),
      f({ fact_key: "SL_LOANS_FROM_SHAREHOLDERS", fact_value_num: 1_930_705, confidence: 1 }),
      f({ fact_key: "SL_OTHER_LIABILITIES", fact_value_num: 284_993, confidence: 1 }),
    ]);
    const bs = certifyBalanceSheet(sel, PERIOD);
    // 6,800,000 − 4,512,938 = 2,287,062 == component sum
    assert.equal(bs.totalLiabilities.status, "certified");
    assert.equal(bs.totalLiabilities.value, 2_287_062);
    assert.equal(bs.identity.status, "ok");
  });

  it("direct Total Liabilities that contradicts components is BLOCKED", () => {
    const sel = certifyFactSelection([
      f({ fact_key: "SL_TOTAL_ASSETS", fact_value_num: 6_800_000 }),
      f({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 4_512_938 }),
      f({ fact_key: "SL_TOTAL_LIABILITIES", fact_value_num: 0 }),
      f({ fact_key: "SL_ACCOUNTS_PAYABLE", fact_value_num: 71_364 }),
      f({ fact_key: "SL_OTHER_LIABILITIES", fact_value_num: 284_993, confidence: 1 }),
    ]);
    const bs = certifyBalanceSheet(sel, PERIOD);
    assert.equal(bs.totalLiabilities.status, "blocked");
  });
});

describe("certifyBalanceSheet — lifecycle filtering through Phase 1 selection", () => {
  it("superseded / rejected / system_invalidated liability facts are ignored", () => {
    // A superseded total-equity = correct value would flip the result, so prove it is ignored:
    // the active (wrong) equity 6.8M still drives the block.
    const sel = certifyFactSelection(
      omniCare2024([
        f({ fact_key: "SL_TOTAL_EQUITY", fact_value_num: 4_512_938, is_superseded: true }),
        f({ fact_key: "SL_OTHER_LIABILITIES", fact_value_num: 9_999_999, resolution_status: "rejected" }),
        f({ fact_key: "SL_ACCOUNTS_PAYABLE", fact_value_num: 8_888_888, resolution_status: "system_invalidated" }),
      ]),
    );
    const bs = certifyBalanceSheet(sel, PERIOD);
    // active equity remains 6.8M (superseded 4.5M ignored) → still blocked
    assert.equal(bs.totalEquity.value, 6_800_000);
    assert.equal(bs.totalLiabilities.status, "blocked");
    // rejected/invalidated inflated components were never selected
    assert.ok(!bs.liabilityComponents.some((c) => c.value.value === 9_999_999 || c.value.value === 8_888_888));
  });

  it("Schedule-L micro OCR values (1, 2, 6) lose to stronger same-key siblings", () => {
    const sel = certifyFactSelection([
      f({ fact_key: "SL_AR_GROSS", fact_value_num: 1, confidence: 0.5, extractor: "taxReturnExtractor:v2:deterministic" }),
      f({ fact_key: "SL_AR_GROSS", fact_value_num: 6_398_442, confidence: 0.8, extractor: "gemini_primary_v1" }),
    ]);
    const arGross = sel.byKeyPeriod.get(`SL_AR_GROSS|${PERIOD}|DEAL|`);
    assert.equal(arGross?.value, 6_398_442);
  });
});
