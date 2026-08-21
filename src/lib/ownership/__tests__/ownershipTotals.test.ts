import test from "node:test";
import assert from "node:assert/strict";

import { summarizeOwnership } from "@/lib/ownership/ownershipTotals";

test("REGRESSION b296dec2: 149% across three rows is not ok", () => {
  const summary = summarizeOwnership([
    { display_name: "Sebrina Colon", ownership_pct: 51 },
    { display_name: "Matthew Paller", ownership_pct: 49 },
    { display_name: "matt paller", ownership_pct: 49 },
  ]);

  assert.equal(summary.totalPct, 149);
  assert.equal(summary.ok, false);

  const codes = summary.issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ["duplicate_owner", "total_mismatch"]);

  const duplicate = summary.issues.find((i) => i.code === "duplicate_owner");
  assert.ok(duplicate && "names" in duplicate);
  assert.deepEqual(duplicate.names, ["Matthew Paller", "matt paller"]);

  const total = summary.issues.find((i) => i.code === "total_mismatch");
  assert.match(total!.message, /149%/);
  assert.match(total!.message, /49% too much/);
});

test("a correct two-owner cap table is ok", () => {
  const summary = summarizeOwnership([
    { display_name: "Sebrina Colon", ownership_pct: 51 },
    { display_name: "Matthew Paller", ownership_pct: 49 },
  ]);
  assert.equal(summary.totalPct, 100);
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.issues, []);
});

test("a sole owner at 100% is ok", () => {
  const summary = summarizeOwnership([{ display_name: "Cher", ownership_pct: 100 }]);
  assert.equal(summary.ok, true);
});

test("an under-100 total says how much is unaccounted for", () => {
  const summary = summarizeOwnership([
    { display_name: "A Person", ownership_pct: 60 },
    { display_name: "B Other", ownership_pct: 25 },
  ]);
  assert.equal(summary.ok, false);
  assert.match(summary.issues[0].message, /15% is still unaccounted for/);
});

test("string percentages from Postgres numerics are counted", () => {
  const summary = summarizeOwnership([
    { display_name: "Sebrina Colon", ownership_pct: "51" },
    { display_name: "Matthew Paller", ownership_pct: "49" },
  ]);
  assert.equal(summary.totalPct, 100);
  assert.equal(summary.ok, true);
});

test("fractional splits inside tolerance are ok", () => {
  const summary = summarizeOwnership([
    { display_name: "A Person", ownership_pct: 33.33 },
    { display_name: "B Other", ownership_pct: 33.33 },
    { display_name: "C Third", ownership_pct: 33.34 },
  ]);
  assert.equal(summary.ok, true);
});

test("owners with no percentage recorded make the total indeterminate, not wrong", () => {
  // Reporting "ownership totals 0%" here would block sealing on data the
  // borrower was never asked for.
  const summary = summarizeOwnership([
    { display_name: "Sebrina Colon", ownership_pct: null },
    { display_name: "Matthew Paller", ownership_pct: null },
  ]);
  assert.equal(summary.indeterminate, true);
  assert.equal(summary.uncountedRows, 2);
  assert.equal(
    summary.issues.some((i) => i.code === "total_mismatch"),
    false,
  );
});

test("a duplicate is still reported when no percentages are recorded", () => {
  const summary = summarizeOwnership([
    { display_name: "Matthew Paller", ownership_pct: null },
    { display_name: "matt paller", ownership_pct: null },
  ]);
  assert.equal(summary.indeterminate, true);
  assert.equal(
    summary.issues.some((i) => i.code === "duplicate_owner"),
    true,
  );
});

test("an out-of-range percentage is called out by name", () => {
  const summary = summarizeOwnership([
    { display_name: "Sebrina Colon", ownership_pct: 140 },
    { display_name: "Matthew Paller", ownership_pct: 49 },
  ]);
  assert.equal(summary.ok, false);
  const invalid = summary.issues.find((i) => i.code === "invalid_pct");
  assert.ok(invalid && "names" in invalid);
  assert.deepEqual(invalid.names, ["Sebrina Colon"]);
});

test("an empty cap table reports no_owners and is indeterminate", () => {
  const summary = summarizeOwnership([]);
  assert.equal(summary.ok, false);
  assert.equal(summary.indeterminate, true);
  assert.deepEqual(
    summary.issues.map((i) => i.code),
    ["no_owners"],
  );
});
