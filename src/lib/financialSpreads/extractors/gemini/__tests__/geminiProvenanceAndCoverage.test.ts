import test from "node:test";
import assert from "node:assert/strict";

import { parseGeminiResponse } from "../geminiResponseParser";
import { buildBalanceSheetPrompt } from "../prompts/balanceSheet";
import { buildBusinessTaxReturnPrompt } from "../prompts/businessTaxReturn";
import { provenanceSnippet } from "@/lib/classicSpread/audit/balanceSheetSourceLineResolver";

/**
 * SPEC-SPREAD-SYSTEM-PERFECTION-HARDENING-1 (Phase 1).
 *
 * Two things this locks:
 *   1. The Gemini-primary parser persists per-fact source evidence into
 *      provenance.citations[].snippet + provenance.raw_snippets[] (the shape the
 *      classic-spread source-line resolver reads), while staying backward
 *      compatible with the legacy flat { KEY: number } shape and never
 *      fabricating snippets.
 *   2. The balance-sheet + business-tax-return prompts now request the
 *      Schedule L / QuickBooks current-asset & current-liability detail keys the
 *      certification system needs.
 */

const base = {
  expectedKeys: ["SL_CASH", "SL_AR_GROSS", "SL_OTHER_LIABILITIES"],
  docType: "BALANCE_SHEET",
  documentId: "doc-1",
  factType: "BALANCE_SHEET",
  periodStart: "2023-12-31",
  periodEnd: "2023-12-31",
};

// ── 1. Parser provenance ────────────────────────────────────────────────────

test("legacy flat shape parses with NO citations/raw_snippets (backward compatible)", () => {
  const { items } = parseGeminiResponse({ ...base, rawJson: { facts: { SL_CASH: 1000 } } });
  assert.equal(items.length, 1);
  const p = items[0].provenance;
  assert.equal(p.extractor, "gemini_primary_v1");
  assert.equal(p.citations, undefined, "no citations when no evidence present");
  assert.equal(p.raw_snippets, undefined, "no raw_snippets when no evidence present");
});

test("sibling evidence map → provenance.citations + raw_snippets", () => {
  const { items } = parseGeminiResponse({
    ...base,
    rawJson: {
      facts: { SL_CASH: 1000, SL_AR_GROSS: 2500 },
      evidence: { SL_CASH: "Cash and cash equivalents 1,000" },
    },
  });
  const cash = items.find((i) => i.factKey === "SL_CASH")!;
  assert.deepEqual(cash.provenance.citations, [
    { page: null, snippet: "Cash and cash equivalents 1,000" },
  ]);
  assert.deepEqual(cash.provenance.raw_snippets, ["Cash and cash equivalents 1,000"]);
  // A fact without an evidence entry stays clean — snippets are never invented.
  const ar = items.find((i) => i.factKey === "SL_AR_GROSS")!;
  assert.equal(ar.provenance.citations, undefined);
});

test("object-valued fact { value, snippet, page } → value + provenance evidence", () => {
  const { items, rawResponse } = parseGeminiResponse({
    ...base,
    rawJson: {
      facts: {
        SL_OTHER_LIABILITIES: {
          value: 10669,
          snippet: "Line 18: 10,669 Other current liabilities (Statement 2)",
          page: 4,
        },
      },
    },
  });
  const f = items.find((i) => i.factKey === "SL_OTHER_LIABILITIES")!;
  assert.equal(f.value, 10669, "numeric value extracted from the object form");
  assert.equal(rawResponse?.facts.SL_OTHER_LIABILITIES, 10669, "rawResponse stays numeric for cross-check");
  assert.deepEqual(f.provenance.citations, [
    { page: 4, snippet: "Line 18: 10,669 Other current liabilities (Statement 2)" },
  ]);
  // And the resolver's snippet extractor can read it back.
  assert.ok(provenanceSnippet(f.provenance).includes("Other current liabilities"));
});

test("hallucinated / unexpected keys are still rejected with evidence present", () => {
  const { items } = parseGeminiResponse({
    ...base,
    rawJson: {
      facts: { SL_CASH: 1000, MADE_UP_KEY: 999 },
      evidence: { MADE_UP_KEY: "totally fabricated" },
    },
  });
  assert.ok(items.every((i) => i.factKey !== "MADE_UP_KEY"));
  assert.equal(items.length, 1);
});

test("blank / non-string evidence does not produce empty citations", () => {
  const { items } = parseGeminiResponse({
    ...base,
    rawJson: { facts: { SL_CASH: 1000 }, evidence: { SL_CASH: "   " } },
  });
  assert.equal(items[0].provenance.citations, undefined);
  assert.equal(items[0].provenance.raw_snippets, undefined);
});

// ── 2. Prompt key coverage ──────────────────────────────────────────────────

test("business tax return prompt covers Schedule L current liabilities / shareholder loans / total", () => {
  const prompt = buildBusinessTaxReturnPrompt("doc text");
  for (const k of [
    "SL_OPERATING_CURRENT_LIABILITIES",
    "SL_LOANS_FROM_SHAREHOLDERS",
    "SL_OTHER_LIABILITIES",
    "SL_TOTAL_CURRENT_LIABILITIES",
  ]) {
    assert.ok(prompt.expectedKeys.includes(k), `BTR expectedKeys must include ${k}`);
    assert.ok(prompt.userPrompt.includes(k), `BTR instructions must describe ${k}`);
  }
  assert.ok(prompt.userPrompt.includes('"evidence"'), "BTR prompt requests per-fact evidence");
  assert.equal(prompt.promptVersion, "gemini_primary_btr_v4");
});

test("balance sheet prompt covers QuickBooks current-asset and current-liability detail", () => {
  const prompt = buildBalanceSheetPrompt("doc text");
  for (const k of [
    "SL_OTHER_CURRENT_ASSETS",
    "SL_WAGES_PAYABLE",
    "SL_OPERATING_CURRENT_LIABILITIES",
    "SL_LOANS_FROM_SHAREHOLDERS",
  ]) {
    assert.ok(prompt.expectedKeys.includes(k), `BS expectedKeys must include ${k}`);
    assert.ok(prompt.userPrompt.includes(k), `BS instructions must describe ${k}`);
  }
  assert.ok(prompt.userPrompt.includes('"evidence"'), "BS prompt requests per-fact evidence");
  assert.equal(prompt.promptVersion, "gemini_primary_bs_v2");
});
