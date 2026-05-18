/**
 * SPEC-SNAPSHOT-DEAL-TYPE-AWARE-1 — Guard tests (2026-05-18)
 *
 * Proves filterRequiredKeysForDealType removes CRE/TTM keys for
 * CONVENTIONAL/SBA but preserves them for CRE.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterRequiredKeysForDealType,
  CRE_ONLY_KEYS,
  TTM_ONLY_KEYS,
} from "../snapshotRequiredKeys";

const ALL_KEYS = [
  "revenue", "ebitda", "dscr", "in_place_rent_mo",
  "occupancy_pct", "ltv_gross", "total_income_ttm", "noi_ttm",
  "net_worth", "working_capital",
];

describe("filterRequiredKeysForDealType", () => {
  test("removes in_place_rent_mo for CONVENTIONAL", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL");
    assert.ok(!result.includes("in_place_rent_mo"));
  });

  test("removes occupancy_pct for SBA", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "SBA");
    assert.ok(!result.includes("occupancy_pct"));
  });

  test("removes ltv_gross for CONVENTIONAL", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL");
    assert.ok(!result.includes("ltv_gross"));
  });

  test("removes total_income_ttm for CONVENTIONAL", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL");
    assert.ok(!result.includes("total_income_ttm"));
  });

  test("removes noi_ttm for SBA_7A", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "SBA_7A");
    assert.ok(!result.includes("noi_ttm"));
  });

  test("does NOT remove in_place_rent_mo for CRE", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "CRE");
    assert.ok(result.includes("in_place_rent_mo"));
  });

  test("preserves revenue and ebitda for CONVENTIONAL", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL");
    assert.ok(result.includes("revenue"));
    assert.ok(result.includes("ebitda"));
  });

  test("defaults to CONVENTIONAL when deal_type is null", () => {
    const result = filterRequiredKeysForDealType(ALL_KEYS, null);
    assert.ok(!result.includes("in_place_rent_mo"));
    assert.ok(!result.includes("total_income_ttm"));
  });
});

describe("snapshot recompute route wiring", () => {
  const ROUTE_SRC = readFileSync(
    resolve(
      __dirname,
      "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts",
    ),
    "utf-8",
  );

  test("imports filterRequiredKeysForDealType", () => {
    assert.ok(
      ROUTE_SRC.includes("filterRequiredKeysForDealType"),
      "snapshot recompute route must import and use filterRequiredKeysForDealType",
    );
  });
});
