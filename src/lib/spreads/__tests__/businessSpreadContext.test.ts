import test from "node:test";
import assert from "node:assert/strict";

import {
  getBusinessSpreadTypesForDealContext,
  getBusinessSpreadsHeaderCopy,
  isPropertyCollateralMode,
  type BusinessSpreadDealContext,
} from "@/lib/spreads/businessSpreadContext";
import { isOptionalSpreadType } from "@/lib/spreads/t12Eligibility";

/**
 * SPEC-BUSINESS-SPREADS-OPERATING-COMPANY-VIEW-1
 *
 * The Business Spreads page must be context-aware. Operating companies (e.g.
 * Omnicare) get operating-company financial sections — never a rent roll, never a
 * speculative trailing-twelve panel. CRE / property deals keep their property
 * sections (rent roll + optional trailing operating performance where a source
 * exists). Both keep the balance sheet as the primary business spread.
 */

// Omnicare is a CONVENTIONAL operating company (no CRE product, no monthly
// operating statements supplied).
const OMNICARE: BusinessSpreadDealContext = {
  dealMode: "full_underwrite",
  dealType: "CONVENTIONAL",
  collateralType: null, // no CRE product_type
  hasT12Source: false,
  hasRentRollSource: false,
};

// ── Operating company (Omnicare) ───────────────────────────────────────────

test("operating-company deal does not request/render RENT_ROLL", () => {
  const types = getBusinessSpreadTypesForDealContext(OMNICARE);
  assert.ok(!types.includes("RENT_ROLL"), "no rent roll for an operating company");
  assert.ok(types.includes("BALANCE_SHEET"), "balance sheet is always primary");
  assert.ok(types.includes("STANDARD"), "operating company shows the income statement / business spread");
});

test("operating-company deal does not request/render T12 without an actual T12 source", () => {
  const types = getBusinessSpreadTypesForDealContext(OMNICARE);
  assert.ok(!types.includes("T12"), "no trailing-twelve panel without a real source");
});

test("operating-company deal with a real monthly-operating source MAY show optional T12", () => {
  const types = getBusinessSpreadTypesForDealContext({ ...OMNICARE, hasT12Source: true });
  assert.ok(types.includes("T12"), "T12 allowed once a real source exists");
  assert.ok(!types.includes("RENT_ROLL"), "still no rent roll for an operating company");
  // It is still an optional spread, and it comes after the primary balance sheet.
  assert.ok(isOptionalSpreadType("T12"));
  assert.ok(types.indexOf("BALANCE_SHEET") < types.indexOf("T12"));
});

// ── CRE / property deal ────────────────────────────────────────────────────

const CRE: BusinessSpreadDealContext = {
  dealMode: "full_underwrite",
  dealType: "CONVENTIONAL",
  collateralType: "CRE_INVESTOR",
  hasT12Source: false,
  hasRentRollSource: false,
};

test("CRE deal still shows RENT_ROLL", () => {
  const types = getBusinessSpreadTypesForDealContext(CRE);
  assert.ok(types.includes("RENT_ROLL"), "rent roll preserved for CRE / property deals");
  assert.ok(types.includes("BALANCE_SHEET"));
  assert.ok(!types.includes("STANDARD"), "CRE keeps its property-section behavior (no operating-company spread)");
});

test("CRE deal shows optional T12 when a trailing-operating source exists", () => {
  const types = getBusinessSpreadTypesForDealContext({ ...CRE, hasT12Source: true });
  assert.ok(types.includes("RENT_ROLL"));
  assert.ok(types.includes("T12"), "optional trailing operating performance shown when source exists");
  assert.ok(types.indexOf("BALANCE_SHEET") < types.indexOf("T12"), "T12 stays after the primary balance sheet");
});

test("CRE deal without a trailing-operating source does not request T12", () => {
  const types = getBusinessSpreadTypesForDealContext(CRE);
  assert.ok(!types.includes("T12"), "no speculative T12 even for CRE");
});

test("a rent-roll source alone marks property mode (defensive signal)", () => {
  assert.equal(isPropertyCollateralMode({ hasRentRollSource: true }), true);
  const types = getBusinessSpreadTypesForDealContext({ hasRentRollSource: true });
  assert.ok(types.includes("RENT_ROLL"));
});

// ── Header copy ────────────────────────────────────────────────────────────

test("header copy is operating-company appropriate (no rent roll / subject property)", () => {
  const copy = getBusinessSpreadsHeaderCopy(OMNICARE);
  assert.equal(copy, "Business financial spreads from company statements and tax returns.");
  assert.ok(!/rent roll/i.test(copy), "operating-company copy must not mention a rent roll");
  assert.ok(!/subject property/i.test(copy), "operating-company copy must not mention a subject property");
});

test("header copy is property-appropriate for CRE deals", () => {
  const copy = getBusinessSpreadsHeaderCopy(CRE);
  assert.equal(
    copy,
    "Property financial spreads, rent roll, and trailing operating performance where available.",
  );
  assert.ok(/rent roll/i.test(copy));
});

// ── Optional label correctness ─────────────────────────────────────────────

test("optional spread label only applies to eligible optional spreads", () => {
  // When T12 is ineligible it is not in the requested set, so it can never be
  // rendered with (or without) the optional label.
  const opCo = getBusinessSpreadTypesForDealContext(OMNICARE);
  assert.ok(!opCo.some((t) => isOptionalSpreadType(t)), "no optional spread requested when none is eligible");

  // When eligible, exactly the optional spread (T12) carries the optional flag;
  // primary business spreads never do.
  const withT12 = getBusinessSpreadTypesForDealContext({ ...CRE, hasT12Source: true });
  const optionalOnes = withT12.filter((t) => isOptionalSpreadType(t));
  assert.deepEqual(optionalOnes, ["T12"]);
  assert.equal(isOptionalSpreadType("BALANCE_SHEET"), false);
  assert.equal(isOptionalSpreadType("RENT_ROLL"), false);
});

test("default/empty context falls back to the safe operating-company set", () => {
  const types = getBusinessSpreadTypesForDealContext({});
  assert.ok(!types.includes("RENT_ROLL"), "empty context must not speculatively request rent roll");
  assert.ok(!types.includes("T12"));
  assert.deepEqual(types, ["BALANCE_SHEET", "STANDARD"]);
});
