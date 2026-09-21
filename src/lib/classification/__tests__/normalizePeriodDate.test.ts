import test from "node:test";
import assert from "node:assert/strict";
import { normalizePeriodDate } from "../normalizePeriodDate";

test("absent or non-date classifier output cannot reach date columns", () => {
  for (const value of ["Not applicable", "N/A", "unknown", "", null, undefined, 2026, {}, "2026", "2026-09", "09/21/2026"]) {
    assert.equal(normalizePeriodDate(value), null, String(value));
  }
});

test("invalid calendar dates are not silently rolled into another period", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "0000-01-01"]) {
    assert.equal(normalizePeriodDate(value), null, value);
  }
});

test("valid dates including leap days survive unchanged", () => {
  for (const value of ["2026-09-21", "2024-02-29", "2000-02-29", "2025-12-31"]) {
    assert.equal(normalizePeriodDate(value), value);
  }
  assert.equal(normalizePeriodDate(" 2026-09-21 "), "2026-09-21");
});
