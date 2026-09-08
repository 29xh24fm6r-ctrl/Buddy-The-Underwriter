import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { selectBestRequiredFacts, selectResolvedGapIds } = require_(
  "@/lib/gapEngine/computeDealGaps",
) as typeof import("@/lib/gapEngine/computeDealGaps");

test("the newest, highest-confidence extraction represents a required key, not the oldest", () => {
  // Production deal c0f6caab: NET_INCOME extracted 2026-08-27 at 55% from a
  // tax return, then 2026-09-02 at 95% from an income statement. The queue
  // still judged the key on the 55% row.
  const best = selectBestRequiredFacts([
    { id: "new", fact_key: "NET_INCOME", fact_value_num: 35746.75, confidence: 0.95, resolution_status: "inferred", created_at: "2026-09-02T19:32:57Z" },
    { id: "mid", fact_key: "NET_INCOME", fact_value_num: 106319, confidence: 0.55, resolution_status: "inferred", created_at: "2026-08-27T22:22:05Z" },
    { id: "old", fact_key: "NET_INCOME", fact_value_num: 155811, confidence: 0.55, resolution_status: "inferred", created_at: "2026-08-27T22:21:52Z" },
  ]);
  assert.equal(best.get("NET_INCOME")?.id, "new");
});

test("a banker-resolved fact wins over a higher-confidence unresolved one", () => {
  const best = selectBestRequiredFacts([
    { id: "extracted", fact_key: "DSCR", fact_value_num: 2.5, confidence: 0.99, resolution_status: "inferred", created_at: "2026-09-02T00:00:00Z" },
    { id: "confirmed", fact_key: "DSCR", fact_value_num: 2.4, confidence: 0.6, resolution_status: "confirmed", created_at: "2026-09-01T00:00:00Z" },
  ]);
  assert.equal(best.get("DSCR")?.id, "confirmed");
});

test("null values never represent a key", () => {
  const best = selectBestRequiredFacts([
    { id: "empty", fact_key: "DEPRECIATION", fact_value_num: null, confidence: 0.99, resolution_status: null, created_at: "2026-09-02T00:00:00Z" },
  ]);
  assert.equal(best.has("DEPRECIATION"), false);
});

test("a stale missing_fact row is resolved even when the same key has a live low_confidence gap", () => {
  // Production 2026-09-08: missing_fact NET_INCOME (Aug 27) survived every
  // recompute because low_confidence NET_INCOME kept the key "live".
  const ids = selectResolvedGapIds(
    [
      { id: "missing-ni", fact_key: "NET_INCOME", gap_type: "missing_fact" },
      { id: "low-ni", fact_key: "NET_INCOME", gap_type: "low_confidence" },
      { id: "missing-tr", fact_key: "TOTAL_REVENUE", gap_type: "missing_fact" },
      { id: "low-dep", fact_key: "DEPRECIATION", gap_type: "low_confidence" },
    ],
    [{ fact_key: "DEPRECIATION", gap_type: "low_confidence" }],
  );
  assert.deepEqual(ids.sort(), ["low-ni", "missing-ni", "missing-tr"]);
});

test("rows matching a current gap stay open; no gaps resolves everything", () => {
  const rows = [
    { id: "a", fact_key: "DSCR", gap_type: "missing_fact" },
    { id: "b", fact_key: "NET_INCOME", gap_type: "conflict" },
  ];
  assert.deepEqual(selectResolvedGapIds(rows, [{ fact_key: "DSCR", gap_type: "missing_fact" }]), ["b"]);
  assert.deepEqual(selectResolvedGapIds(rows, []).sort(), ["a", "b"]);
});
