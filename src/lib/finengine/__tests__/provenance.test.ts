import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveEngineFromSourceRef,
  retirementPhaseForSourceRef,
  inferSourceQualityRank,
  stampProvenance,
  FINENGINE_VERSION,
} from "@/lib/finengine/provenance";
import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";

describe("resolveEngineFromSourceRef (Phase 0 backfill map)", () => {
  it("maps each seeded source_ref pattern to its engine", () => {
    assert.equal(resolveEngineFromSourceRef("synthesis:golden_run:80fe6f7a"), "hardcode");
    assert.equal(resolveEngineFromSourceRef("synthesis:canonical_alias:abc"), "hardcode");
    assert.equal(resolveEngineFromSourceRef("computeGlobalCashFlow:v2"), "finengine.b4");
    assert.equal(resolveEngineFromSourceRef("deal_spreads:GLOBAL_CASH_FLOW"), "finengine.b4");
    assert.equal(resolveEngineFromSourceRef("computed:classic_spread:v2"), "legacy.classicSpread");
    assert.equal(resolveEngineFromSourceRef("computed:noi/total_debt"), "legacy.noiPath");
    assert.equal(resolveEngineFromSourceRef("computed:stress:rate_up_300bps"), "legacy.stress");
    assert.equal(resolveEngineFromSourceRef("deal_structural_pricing:abc"), "legacy.structuralPricing");
    assert.equal(resolveEngineFromSourceRef("total_debt:abc"), "legacy.structuralPricing");
    assert.equal(resolveEngineFromSourceRef("deal_spreads:T12:foo"), "finengine.spreads");
    assert.equal(resolveEngineFromSourceRef("deal_documents:abc"), "extraction.docExtract");
    assert.equal(resolveEngineFromSourceRef("tax_return:uuid:od_detail_backfill"), "extraction.taxReturn");
    assert.equal(resolveEngineFromSourceRef("deal_loan_requests:uuid"), "manual.loanRequest");
  });

  it("returns 'unknown' for unmapped refs and null/empty", () => {
    assert.equal(resolveEngineFromSourceRef("something:weird"), "unknown");
    assert.equal(resolveEngineFromSourceRef(null), "unknown");
    assert.equal(resolveEngineFromSourceRef(""), "unknown");
  });

  it("GLOBAL_CASH_FLOW exact match resolves to b4, not the generic deal_spreads rule", () => {
    // ordering invariant — the specific rule must precede the generic deal_spreads rule
    assert.equal(resolveEngineFromSourceRef("deal_spreads:GLOBAL_CASH_FLOW"), "finengine.b4");
  });

  it("documents retirement phases", () => {
    assert.equal(retirementPhaseForSourceRef("synthesis:golden_run:x"), "Phase 0 (delete)");
    assert.equal(retirementPhaseForSourceRef("computed:noi/total_debt"), "Phase 6");
    assert.equal(retirementPhaseForSourceRef("deal_spreads:T12:x"), "keep");
  });
});

describe("inferSourceQualityRank (§2.3 hierarchy, 1 strongest .. 7 weakest)", () => {
  it("pins the hardcoded golden-run fact to the weakest rank (never wins)", () => {
    assert.equal(inferSourceQualityRank({ sourceRef: "synthesis:golden_run:80fe6f7a" }), 7);
  });
  it("ranks IRS transcript above a filed tax return above a signed PFS", () => {
    const transcript = inferSourceQualityRank({ sourceCanonicalType: "IRS_4506C_TRANSCRIPT" });
    const taxReturn = inferSourceQualityRank({ sourceCanonicalType: "BUSINESS_TAX_RETURN" });
    const pfs = inferSourceQualityRank({ sourceCanonicalType: "PERSONAL_FINANCIAL_STATEMENT" });
    assert.equal(transcript, 1);
    assert.equal(taxReturn, 2);
    assert.equal(pfs, 3);
    assert.ok(transcript < taxReturn && taxReturn < pfs);
  });
  it("ranks finengine-computed above legacy-computed facts", () => {
    const fin = inferSourceQualityRank({ sourceRef: "computeGlobalCashFlow:v2" });
    const legacy = inferSourceQualityRank({ sourceRef: "computed:noi/total_debt" });
    assert.ok(fin < legacy, `finengine (${fin}) should rank stronger than legacy (${legacy})`);
  });
  it("ranks strong OCR above weak OCR micro-facts by confidence", () => {
    const strong = inferSourceQualityRank({ sourceRef: "deal_documents:x", confidence: 0.9 });
    const weak = inferSourceQualityRank({ sourceRef: "deal_documents:x", confidence: 0.2 });
    assert.equal(strong, 6);
    assert.equal(weak, 7);
  });
});

describe("stampProvenance (single-chokepoint normalizer)", () => {
  const base: FinancialFactProvenance = {
    source_type: "SPREAD",
    source_ref: "computed:noi/total_debt",
    as_of_date: null,
  };

  it("adds engine + version + rank without mutating input or existing fields", () => {
    const out = stampProvenance(base);
    // input untouched
    assert.equal((base as Record<string, unknown>).engine, undefined);
    // normalized fields present
    assert.equal(out.engine, "legacy.noiPath");
    assert.equal(typeof out.version, "string");
    assert.ok(out.source_quality_rank! >= 1 && out.source_quality_rank! <= 7);
    // legacy fields preserved verbatim
    assert.equal(out.source_type, "SPREAD");
    assert.equal(out.source_ref, "computed:noi/total_debt");
  });

  it("is idempotent — preserves an already-stamped engine/version", () => {
    const pre = stampProvenance({ ...base, engine: "finengine.core", version: "1.0.0" });
    const post = stampProvenance(pre);
    assert.equal(post.engine, "finengine.core");
    assert.equal(post.version, "1.0.0");
  });

  it("derives :vN version from extractor/source_ref", () => {
    const out = stampProvenance({ ...base, source_ref: "computeGlobalCashFlow:v2", extractor: "persistGlobalCashFlow:v2" });
    assert.equal(out.version, "v2");
  });

  it("stamps finengine engines with the current core version when unversioned", () => {
    const out = stampProvenance({ source_type: "SPREAD", source_ref: "deal_spreads:T12:x", as_of_date: null });
    assert.equal(out.engine, "finengine.spreads");
    assert.equal(out.version, FINENGINE_VERSION);
  });

  it("threads method + sourceCanonicalType context", () => {
    const out = stampProvenance(base, { method: "CRE_NOI", sourceCanonicalType: "BUSINESS_TAX_RETURN" });
    assert.equal(out.method, "CRE_NOI");
    assert.equal(out.source_quality_rank, 2); // tax return rank dominates
  });
});
