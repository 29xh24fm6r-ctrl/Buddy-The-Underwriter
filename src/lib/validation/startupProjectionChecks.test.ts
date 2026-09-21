import test from "node:test";
import assert from "node:assert/strict";
import { startupProjectionChecks } from "./startupProjectionChecks";
import type { AnnualProjectionYear } from "@/lib/sba/sbaReadinessTypes";

const opening = { cash: 250000, totalAssets: 250000, totalLiabilities: 0, equity: 250000 };
const years = [1,2,3].map(year => ({ year, label: "Projected", revenue: 1500000, netIncome: 300000,
  ebitda: 400000, totalDebtService: 200000, dscr: 2 }) as AnnualProjectionYear);
test("startup completeness uses explicitly identified forecasts and retains a review flag", () => {
  const checks = startupProjectionChecks(years, opening);
  assert.equal(checks.some(c => c.status === "BLOCK"), false);
  assert.ok(checks.some(c => c.status === "FLAG" && /not historical/.test(c.message)));
  assert.equal(checks.filter(c => /DSCR reconciliation/.test(c.name)).length, 3);
});
test("an imbalanced opening statement still blocks a startup", () => {
  assert.ok(startupProjectionChecks(years, { ...opening, totalAssets: 300000 }).some(c => c.status === "BLOCK" && /imbalance/.test(c.message)));
});
test("invalid or missing projection values cannot pass as calculated metrics", () => {
  for (const invalid of [NaN, Infinity, null, undefined]) {
    const changed = structuredClone(years); changed[1].revenue = invalid as number;
    assert.ok(startupProjectionChecks(changed, opening).some(c => c.status === "BLOCK"));
  }
  assert.ok(startupProjectionChecks(years.slice(0,2), opening).some(c => c.status === "BLOCK"));
});
test("forecast DSCR inconsistencies are blocked by the existing reconciliation rule", () => {
  const changed = structuredClone(years); changed[0].dscr = 5;
  assert.ok(startupProjectionChecks(changed, opening).some(c => c.status === "BLOCK" && /DSCR/.test(c.name)));
});
