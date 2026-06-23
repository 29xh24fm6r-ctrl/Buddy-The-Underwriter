import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { filterRequiredKeysForDealType } from "../snapshotRequiredKeys";

const ALL_KEYS = [
  "revenue", "ebitda", "dscr", "in_place_rent_mo",
  "occupancy_pct", "ltv_gross", "total_income_ttm", "noi_ttm",
  "net_worth", "working_capital",
];

describe("filterRequiredKeysForDealType", () => {
  test("removes in_place_rent_mo for CONVENTIONAL", () => {
    assert.ok(!filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL").includes("in_place_rent_mo"));
  });
  test("removes occupancy_pct for SBA", () => {
    assert.ok(!filterRequiredKeysForDealType(ALL_KEYS, "SBA").includes("occupancy_pct"));
  });
  test("removes total_income_ttm for CONVENTIONAL", () => {
    assert.ok(!filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL").includes("total_income_ttm"));
  });
  test("does NOT remove in_place_rent_mo for CRE", () => {
    assert.ok(filterRequiredKeysForDealType(ALL_KEYS, "CRE").includes("in_place_rent_mo"));
  });
  test("preserves revenue and ebitda for CONVENTIONAL", () => {
    const r = filterRequiredKeysForDealType(ALL_KEYS, "CONVENTIONAL");
    assert.ok(r.includes("revenue") && r.includes("ebitda"));
  });
});

describe("snapshot recompute route wiring", () => {
  const ROUTE_SRC = readFileSync(
    resolve(__dirname, "../../../app/api/deals/[dealId]/financial-snapshot/recompute/route.ts"),
    "utf-8",
  );
  test("imports filterRequiredKeysForDealType", () => {
    assert.ok(ROUTE_SRC.includes("filterRequiredKeysForDealType"));
  });
});
