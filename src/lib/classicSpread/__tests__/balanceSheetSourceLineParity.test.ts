/**
 * SPEC-CLASSIC-SPREAD-BS-SOURCE-LINE-PARITY-2 — balance-sheet source-line parity (fixture-first).
 *
 * Three provenance-SCOPED fixes, each backed by OmniCare-shaped fixture facts that carry the source
 * line / provenance snippet (never blind numeric heuristics):
 *   1. Schedule L "Other current liabilities" (Statement 2) classified as a CURRENT liability only
 *      when the source line says so.
 *   2. 2024 OCR micro-stub facts suppressed only when the provenance snippet matches the stub
 *      signature AND a stronger same-period fact contradicts them.
 *   3. 2026 interim "Accounts receivable" remapped to AR (not Total Current Assets) by label/provenance.
 *
 * No income-statement key/behaviour, schema, route, or PDF/memo render is touched by these rules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  resolveBalanceSheetSourceLines,
  provenanceSnippet,
  type SourceLineFact,
} from "../audit/balanceSheetSourceLineResolver";
import { resolveBalanceSheet, type Facts } from "../audit/statementTruthResolver";
import { parseGeminiResponse } from "@/lib/financialSpreads/extractors/gemini/geminiResponseParser";

// Build a fixture fact carrying a provenance citation snippet (as the extractors write it).
const f = (
  fact_key: string,
  fact_value_num: number,
  fact_period_end: string,
  snippet: string,
  confidence = 0.5,
): SourceLineFact => ({
  fact_key,
  fact_value_num,
  fact_period_end,
  confidence,
  provenance: { citations: [{ page: null, snippet }], raw_snippets: [snippet] },
});

const auditFor = (
  audit: ReturnType<typeof resolveBalanceSheetSourceLines>["audit"],
  originalKey: string,
  period: string,
) => audit.find((a) => a.originalKey === originalKey && a.periodEnd === period);

const factsRecord = (facts: SourceLineFact[], period: string): Facts => {
  const out: Facts = {};
  for (const x of facts) if (x.fact_period_end === period && x.fact_value_num != null) out[x.fact_key] = x.fact_value_num;
  return out;
};

// ── provenance snippet extraction ───────────────────────────────────────────────────────────────
describe("provenanceSnippet", () => {
  it("joins citation snippets and raw_snippets, tolerating missing provenance", () => {
    assert.equal(provenanceSnippet({ citations: [{ page: 1, snippet: "Line 18: 10,669" }] }).includes("Line 18"), true);
    assert.equal(provenanceSnippet(null), "");
    assert.equal(provenanceSnippet({ raw_snippets: ["Accounts receivable"] }), "Accounts receivable");
  });
});

// ── #1 Schedule L Statement 2 Other Current Liabilities ─────────────────────────────────────────
describe("Other current liabilities classified by source line", () => {
  it("remaps SL_OTHER_LIABILITIES to a CURRENT liability when the source line says 'other current liabilities'", () => {
    const facts = [
      f("SL_ACCOUNTS_PAYABLE", 31_669, "2023-12-31", "Line 16: 31,669 Accounts payable"),
      f("SL_OTHER_LIABILITIES", 10_669, "2023-12-31", "Line 18: 10,669 Other current liabilities (Statement 2)"),
      f("SL_MORTGAGES_NOTES_BONDS", 1_730_705, "2023-12-31", "Line 20: 1,730,705 Mortgages, notes, bonds payable in 1 year or more"),
    ];
    const { facts: out, audit } = resolveBalanceSheetSourceLines(facts);
    const a = auditFor(audit, "SL_OTHER_LIABILITIES", "2023-12-31");
    assert.ok(a, "must emit a reclassification audit entry");
    assert.equal(a!.code, "OCL_RECLASSIFIED_CURRENT");
    assert.equal(a!.resolvedKey, "SL_OPERATING_CURRENT_LIABILITIES");
    // the remapped fact now carries the current-liability key
    assert.ok(out.some((x) => x.fact_key === "SL_OPERATING_CURRENT_LIABILITIES" && x.fact_value_num === 10_669));
    assert.ok(!out.some((x) => x.fact_key === "SL_OTHER_LIABILITIES"));

    // end-to-end: TCL = AP + OCL, TNCL = mortgages, TL = 1,773,043
    const r = resolveBalanceSheet(factsRecord(out, "2023-12-31"));
    assert.equal(r.totalCurrentLiabilities.value, 42_338);
    assert.equal(r.totalLiabilities.value, 1_773_043);
  });

  it("does NOT remap when the source line indicates a long-term / non-current 'other liabilities'", () => {
    const facts = [
      f("SL_OTHER_LIABILITIES", 284_993, "2024-12-31", "Line 21: 284,993 Other liabilities (long-term)"),
    ];
    const { facts: out, audit } = resolveBalanceSheetSourceLines(facts);
    assert.equal(auditFor(audit, "SL_OTHER_LIABILITIES", "2024-12-31"), undefined);
    assert.ok(out.some((x) => x.fact_key === "SL_OTHER_LIABILITIES" && x.fact_value_num === 284_993));
  });

  it("does NOT remap when there is no source line to confirm the current-liability section", () => {
    const facts = [f("SL_OTHER_LIABILITIES", 5_000, "2023-12-31", "")];
    const { audit } = resolveBalanceSheetSourceLines(facts);
    assert.equal(audit.length, 0);
  });
});

// ── #2 2024 OCR micro-stub suppression ──────────────────────────────────────────────────────────
describe("OCR micro-stub suppression by provenance signature", () => {
  it("suppresses line-number micro-stubs when a stronger same-period fact contradicts them", () => {
    const facts = [
      f("SL_TOTAL_ASSETS", 6_800_000, "2024-12-31", "Line 15: 6,800,000 Total assets", 0.85),
      f("SL_INVENTORY", 4, "2024-12-31", "line 3, 6"),
      f("SL_OTHER_CURRENT_ASSETS", 6, "2024-12-31", "line 6 from line 4"),
      f("SL_SHAREHOLDER_LOANS_RECEIVABLE", 10, "2024-12-31", "Line 10: 10"),
    ];
    const { facts: out, audit } = resolveBalanceSheetSourceLines(facts);
    for (const k of ["SL_INVENTORY", "SL_OTHER_CURRENT_ASSETS", "SL_SHAREHOLDER_LOANS_RECEIVABLE"]) {
      const a = auditFor(audit, k, "2024-12-31");
      assert.ok(a, `${k} stub must be suppressed`);
      assert.equal(a!.code, "MICRO_STUB_SUPPRESSED");
      assert.equal(a!.resolvedKey, null);
      assert.ok(!out.some((x) => x.fact_key === k), `${k} must be removed from the fact set`);
    }
    // the strong sourced total is preserved (never deleted, never globally down-ranked)
    assert.ok(out.some((x) => x.fact_key === "SL_TOTAL_ASSETS" && x.fact_value_num === 6_800_000));
  });

  it("does NOT suppress a small value that lacks the stub provenance signature", () => {
    const facts = [
      f("SL_TOTAL_ASSETS", 6_800_000, "2024-12-31", "Total assets", 0.85),
      f("SL_INVENTORY", 4, "2024-12-31", "Inventory"), // legitimate small inventory, normal label
    ];
    const { audit } = resolveBalanceSheetSourceLines(facts);
    assert.equal(auditFor(audit, "SL_INVENTORY", "2024-12-31"), undefined);
  });

  it("does NOT suppress a stub when no stronger same-period fact exists", () => {
    const facts = [f("SL_INVENTORY", 4, "2024-12-31", "line 3, 6")];
    const { audit } = resolveBalanceSheetSourceLines(facts);
    assert.equal(audit.length, 0);
  });
});

// ── #3 2026 interim Accounts Receivable mapping ─────────────────────────────────────────────────
describe("interim Accounts Receivable mapped by label/provenance", () => {
  it("remaps a TOTAL_CURRENT_ASSETS fact to AR when the source line says 'accounts receivable'", () => {
    const facts = [
      f("SL_CASH", 198_693, "2026-06-30", "Cash"),
      f("SL_TOTAL_CURRENT_ASSETS", 3_097_345, "2026-06-30", "Accounts receivable"),
    ];
    const { facts: out, audit } = resolveBalanceSheetSourceLines(facts);
    const a = auditFor(audit, "SL_TOTAL_CURRENT_ASSETS", "2026-06-30");
    assert.ok(a);
    assert.equal(a!.code, "INTERIM_AR_REMAPPED");
    assert.equal(a!.resolvedKey, "SL_AR_GROSS");
    assert.ok(out.some((x) => x.fact_key === "SL_AR_GROSS" && x.fact_value_num === 3_097_345));
    assert.ok(!out.some((x) => x.fact_key === "SL_TOTAL_CURRENT_ASSETS"));

    // end-to-end: TCA is now the component sum cash + AR = 3,296,038 (not AR-only)
    const r = resolveBalanceSheet(factsRecord(out, "2026-06-30"));
    assert.equal(r.totalCurrentAssets.value, 3_296_038);
  });

  it("keeps TOTAL_CURRENT_ASSETS when the source line actually says total current assets", () => {
    const facts = [f("SL_TOTAL_CURRENT_ASSETS", 3_296_038, "2026-06-30", "Total current assets")];
    const { audit, facts: out } = resolveBalanceSheetSourceLines(facts);
    assert.equal(auditFor(audit, "SL_TOTAL_CURRENT_ASSETS", "2026-06-30"), undefined);
    assert.ok(out.some((x) => x.fact_key === "SL_TOTAL_CURRENT_ASSETS"));
  });

  it("preserves BOTH when an AR source line and a genuine total-current-assets source line exist", () => {
    const facts = [
      f("SL_AR_GROSS", 3_097_345, "2026-06-30", "Accounts receivable"),
      f("SL_TOTAL_CURRENT_ASSETS", 3_296_038, "2026-06-30", "Total current assets"),
    ];
    const { facts: out, audit } = resolveBalanceSheetSourceLines(facts);
    assert.equal(audit.length, 0);
    assert.ok(out.some((x) => x.fact_key === "SL_AR_GROSS"));
    assert.ok(out.some((x) => x.fact_key === "SL_TOTAL_CURRENT_ASSETS"));
  });
});

// ── Gemini-primary provenance → resolver (SPEC-…-HARDENING-1 Phase 1) ────────────────────────────
// Proves the enriched Gemini parser produces provenance the resolver can act on:
// a Gemini-primary fact carrying a source-line snippet triggers the existing
// OCL_RECLASSIFIED_CURRENT behavior, identical to a deterministic-extractor fact.
describe("Gemini-primary facts carry resolver-usable provenance", () => {
  // Map a parsed ExtractedLineItem onto the resolver's SourceLineFact shape.
  const toSourceLineFact = (item: {
    factKey: string;
    value: number;
    periodEnd: string | null;
    provenance: unknown;
  }): SourceLineFact => ({
    fact_key: item.factKey,
    fact_value_num: item.value,
    fact_period_end: item.periodEnd,
    provenance: item.provenance,
  });

  it("a Gemini-primary 'other current liabilities' fact reclassifies to a CURRENT liability", () => {
    const { items } = parseGeminiResponse({
      rawJson: {
        facts: { SL_OTHER_LIABILITIES: 10_669 },
        evidence: { SL_OTHER_LIABILITIES: "Line 18: 10,669 Other current liabilities (Statement 2)" },
      },
      expectedKeys: ["SL_OTHER_LIABILITIES"],
      docType: "BUSINESS_TAX_RETURN",
      documentId: "doc-omni",
      factType: "TAX_RETURN",
      periodStart: "2023-12-31",
      periodEnd: "2023-12-31",
    });
    // The parser attached citations/raw_snippets the resolver reads.
    assert.ok(provenanceSnippet(items[0].provenance).includes("Other current liabilities"));

    const { facts: out, audit } = resolveBalanceSheetSourceLines(items.map(toSourceLineFact));
    const a = audit.find((x) => x.originalKey === "SL_OTHER_LIABILITIES" && x.periodEnd === "2023-12-31");
    assert.ok(a, "Gemini-primary provenance must trigger the source-line resolver");
    assert.equal(a!.code, "OCL_RECLASSIFIED_CURRENT");
    assert.equal(a!.resolvedKey, "SL_OPERATING_CURRENT_LIABILITIES");
    assert.ok(out.some((x) => x.fact_key === "SL_OPERATING_CURRENT_LIABILITIES" && x.fact_value_num === 10_669));
  });

  it("a Gemini-primary fact with NO evidence does NOT trigger the resolver (no fabricated provenance)", () => {
    const { items } = parseGeminiResponse({
      rawJson: { facts: { SL_OTHER_LIABILITIES: 10_669 } },
      expectedKeys: ["SL_OTHER_LIABILITIES"],
      docType: "BUSINESS_TAX_RETURN",
      documentId: "doc-omni",
      factType: "TAX_RETURN",
      periodStart: "2023-12-31",
      periodEnd: "2023-12-31",
    });
    assert.equal(provenanceSnippet(items[0].provenance), "");
    const { audit } = resolveBalanceSheetSourceLines(items.map(toSourceLineFact));
    assert.equal(audit.length, 0);
  });
});
