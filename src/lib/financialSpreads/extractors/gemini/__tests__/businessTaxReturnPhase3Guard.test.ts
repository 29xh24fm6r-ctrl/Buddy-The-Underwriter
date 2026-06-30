/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 3 (revised) — 1120 extraction
 * completeness guards.
 *
 * The two remaining 1120 identity checks bind these canonical operands:
 *   - 1120_TAXABLE_INCOME : TOTAL_INCOME = TOTAL_DEDUCTIONS + TAXABLE_INCOME
 *   - 1120_BALANCE_SHEET  : TOTAL_ASSETS = TOTAL_LIABILITIES + TOTAL_EQUITY
 *
 * Three layers gate a new key reaching the validator: the prompt instructions,
 * the EXPECTED_KEYS allowlist (which IS the schema and the value handed to the
 * parser), and the parser's expectedKeys filter. These guards assert all three
 * admit the operand-bearing keys, and that the additive change left existing
 * field instructions untouched.
 *
 * §0 finding: SL_TOTAL_LIABILITIES / SL_TOTAL_EQUITY were already requested
 * since prompt v2 — only TOTAL_DEDUCTIONS is newly added. Re-extraction alone
 * captures the Schedule-L pair; this phase makes the prompt complete for all
 * three operands.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildBusinessTaxReturnPrompt } from "@/lib/financialSpreads/extractors/gemini/prompts/businessTaxReturn";
import { canonicalizeFactMap } from "@/lib/irsKnowledge/canonicalFactKeys";

// The parser lives one directory up from __tests__.
function readParser(): string {
  return readFileSync(path.resolve(__dirname, "../geminiResponseParser.ts"), "utf-8");
}

// The operand-bearing extractor keys for the two remaining 1120 checks.
const REQUIRED_KEYS = ["TOTAL_DEDUCTIONS", "SL_TOTAL_LIABILITIES", "SL_TOTAL_EQUITY"];

// ── Layer 1+2: prompt instructions + EXPECTED_KEYS allowlist ───────────────

test("[vgr3-a] BTR prompt requests all three 1120-completeness keys (allowlist + instructions)", () => {
  const prompt = buildBusinessTaxReturnPrompt("doc text");
  for (const k of REQUIRED_KEYS) {
    assert.ok(prompt.expectedKeys.includes(k), `BTR expectedKeys must include ${k}`);
    assert.ok(prompt.userPrompt.includes(k), `BTR instructions must describe ${k}`);
  }
});

test("[vgr3-b] TOTAL_DEDUCTIONS is mapped to the corporate total-deductions line(s)", () => {
  const prompt = buildBusinessTaxReturnPrompt("doc text");
  // Line 27 (1120) is the headline; 1065/1120S equivalents named for the shared prompt.
  assert.match(
    prompt.userPrompt,
    /TOTAL_DEDUCTIONS: Total deductions \(Form 1120 Line 27/,
    "TOTAL_DEDUCTIONS must be anchored to Form 1120 line 27",
  );
});

test("[vgr3-c] prompt version bumped (text changed → cache must miss on re-extract)", () => {
  const prompt = buildBusinessTaxReturnPrompt("doc text");
  assert.equal(prompt.promptVersion, "gemini_primary_btr_v4");
});

// ── Layer 3: parser allowlist is driven by expectedKeys (no separate filter) ─

test("[vgr3-d] parser filters strictly to expectedKeys — keys in the allowlist are NOT dropped", () => {
  const PARSER = readParser();
  // The single allowlist is the prompt's expectedKeys, threaded into the parser.
  assert.match(PARSER, /const expectedSet = new Set\(args\.expectedKeys\)/, "parser must build its allowlist from expectedKeys");
  assert.match(PARSER, /if \(!expectedSet\.has\(key\)\) continue/, "parser must filter to expectedKeys only");
  // No hard-coded key denylist that could re-drop a requested key.
  for (const k of REQUIRED_KEYS) {
    assert.equal(
      new RegExp(`delete[\\s\\S]{0,40}${k}|${k}[\\s\\S]{0,40}continue`).test(PARSER),
      false,
      `parser must not special-case-drop ${k}`,
    );
  }
});

// ── Additive-only regression: existing field instructions unchanged ────────

test("[vgr3-e] existing BTR field instructions are untouched (additive only)", () => {
  const prompt = buildBusinessTaxReturnPrompt("doc text");
  const UNCHANGED = [
    "- GROSS_RECEIPTS: Gross receipts or sales (Line 1a/1c)",
    "- COST_OF_GOODS_SOLD: Cost of goods sold (Line 2)",
    "- GROSS_PROFIT: Gross profit (Line 3)",
    "- TOTAL_INCOME: Total income (Line 6 or 11)",
    "- M1_TAXABLE_INCOME: Income on return (Line 10)",
    "- SL_TOTAL_ASSETS: Total assets from Schedule L",
    "- SL_TOTAL_LIABILITIES: Total liabilities from Schedule L",
    "- SL_TOTAL_EQUITY: Total equity / partners capital from Schedule L",
  ];
  for (const line of UNCHANGED) {
    assert.ok(prompt.userPrompt.includes(line), `existing instruction must be unchanged: ${line}`);
  }
});

// ── Binding: the new keys canonicalize to the check operands ───────────────

test("[vgr3-f] new keys bind their FormSpec operands via Phase-1 normalization", () => {
  const out = canonicalizeFactMap({
    TOTAL_DEDUCTIONS: 3_332_674, // canonical name → passes through (direct bind)
    SL_TOTAL_LIABILITIES: 4_000_000, // → TOTAL_LIABILITIES
    SL_TOTAL_EQUITY: 2_800_000, // → TOTAL_EQUITY
  });
  assert.equal(out.TOTAL_DEDUCTIONS, 3_332_674, "TOTAL_DEDUCTIONS binds directly (canonical key)");
  assert.equal(out.TOTAL_LIABILITIES, 4_000_000, "SL_TOTAL_LIABILITIES → TOTAL_LIABILITIES");
  assert.equal(out.TOTAL_EQUITY, 2_800_000, "SL_TOTAL_EQUITY → TOTAL_EQUITY");
});
