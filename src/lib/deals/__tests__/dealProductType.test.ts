import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getProductType,
  isLOC,
  isSBA,
  needsProductTypeSelection,
  requiresSBAChecklist,
} from "../dealProductType";

test("getProductType returns null when product_type is missing or empty", () => {
  assert.equal(getProductType({}), null);
  assert.equal(getProductType({ product_type: null }), null);
  assert.equal(getProductType({ product_type: "" }), null);
  assert.equal(getProductType({ product_type: "  " }), null);
});

test("getProductType normalizes case and returns recognized values", () => {
  assert.equal(getProductType({ product_type: "line_of_credit" }), "LINE_OF_CREDIT");
  assert.equal(getProductType({ product_type: "SBA_7A" }), "SBA_7A");
});

test("getProductType returns null for unknown values (does not pass through garbage)", () => {
  assert.equal(getProductType({ product_type: "GARBAGE" }), null);
  assert.equal(getProductType({ product_type: "sba" }), null); // ambiguous — must be specific
});

test("isSBA: explicit SBA product → true", () => {
  assert.equal(isSBA({ product_type: "SBA_7A" }), true);
  assert.equal(isSBA({ product_type: "SBA_504" }), true);
  assert.equal(isSBA({ product_type: "SBA_EXPRESS" }), true);
});

test("isSBA: non-SBA product → false even if deal_type='SBA'", () => {
  assert.equal(isSBA({ product_type: "LINE_OF_CREDIT", deal_type: "SBA" }), false);
  assert.equal(isSBA({ product_type: "TERM_LOAN" }), false);
  assert.equal(isSBA({ product_type: "CRE" }), false);
});

test("isSBA: NULL product_type → false (does NOT fall back to deal_type)", () => {
  // Strict: isSBA only honors product_type. The legacy fallback lives in
  // requiresSBAChecklist below.
  assert.equal(isSBA({ deal_type: "SBA" }), false);
  assert.equal(isSBA({ deal_type: "SBA", product_type: null }), false);
});

test("isLOC recognizes LINE_OF_CREDIT only", () => {
  assert.equal(isLOC({ product_type: "LINE_OF_CREDIT" }), true);
  assert.equal(isLOC({ product_type: "TERM_LOAN" }), false);
  assert.equal(isLOC({ product_type: "SBA_7A" }), false);
  assert.equal(isLOC({}), false);
});

test("requiresSBAChecklist: modern path — product_type wins", () => {
  // Conventional LOC stored as legacy 'SBA' deal_type — product_type wins
  assert.equal(
    requiresSBAChecklist({ deal_type: "SBA", product_type: "LINE_OF_CREDIT" }),
    false,
  );
  // SBA product on a "CONVENTIONAL" deal_type — product_type wins
  assert.equal(
    requiresSBAChecklist({ deal_type: "CONVENTIONAL", product_type: "SBA_7A" }),
    true,
  );
});

test("requiresSBAChecklist: legacy fallback when product_type is NULL", () => {
  // Existing SBA deals (pre-P0a migration) keep working
  assert.equal(requiresSBAChecklist({ deal_type: "SBA" }), true);
  assert.equal(requiresSBAChecklist({ deal_type: "SBA", product_type: null }), true);
  // Conventional with no product_type — not SBA
  assert.equal(requiresSBAChecklist({ deal_type: "CONVENTIONAL" }), false);
  assert.equal(requiresSBAChecklist({ deal_type: "CONVENTIONAL", product_type: null }), false);
});

test("requiresSBAChecklist: completely empty deal → not SBA", () => {
  assert.equal(requiresSBAChecklist({}), false);
});

test("needsProductTypeSelection: NULL/missing → true", () => {
  assert.equal(needsProductTypeSelection({}), true);
  assert.equal(needsProductTypeSelection({ deal_type: "CONVENTIONAL" }), true);
  assert.equal(needsProductTypeSelection({ deal_type: "SBA" }), true);
});

test("needsProductTypeSelection: any valid product_type → false", () => {
  assert.equal(needsProductTypeSelection({ product_type: "LINE_OF_CREDIT" }), false);
  assert.equal(needsProductTypeSelection({ product_type: "SBA_7A" }), false);
});

// Acceptance test from the spec: conventional LOC deal does not become SBA.
test("acceptance: LINE_OF_CREDIT product never triggers SBA checklist", () => {
  const conventionalLOC = { deal_type: "CONVENTIONAL", product_type: "LINE_OF_CREDIT" };
  assert.equal(isSBA(conventionalLOC), false);
  assert.equal(isLOC(conventionalLOC), true);
  assert.equal(requiresSBAChecklist(conventionalLOC), false);

  // Even if someone left deal_type at the legacy 'SBA' default by mistake,
  // an explicit LINE_OF_CREDIT product_type still wins.
  const stuckOnLegacyDealType = { deal_type: "SBA", product_type: "LINE_OF_CREDIT" };
  assert.equal(requiresSBAChecklist(stuckOnLegacyDealType), false);
});
