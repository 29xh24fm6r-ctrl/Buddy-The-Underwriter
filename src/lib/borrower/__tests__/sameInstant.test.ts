import test from "node:test";
import assert from "node:assert/strict";

import { isSameInstant } from "@/lib/borrower/sameInstant";

test("JS ISO 'Z' and PostgREST '+00:00' spellings of one instant compare equal", () => {
  assert.equal(isSameInstant("2026-09-10T07:00:03.498Z", "2026-09-10T07:00:03.498+00:00"), true);
});

test("trimmed trailing fractional zeros still compare equal", () => {
  assert.equal(isSameInstant("2026-09-10T07:00:03.500Z", "2026-09-10T07:00:03.5+00:00"), true);
  assert.equal(isSameInstant("2026-09-10T07:00:03.000Z", "2026-09-10T07:00:03+00:00"), true);
});

test("different instants compare unequal", () => {
  assert.equal(isSameInstant("2026-09-10T07:00:03.498Z", "2026-09-10T07:00:03.499+00:00"), false);
  assert.equal(isSameInstant("2026-09-10T07:00:03.498Z", "2026-09-10T07:00:09.853+00:00"), false);
});

test("non-strings and unparseable values compare unequal", () => {
  assert.equal(isSameInstant(null, "2026-09-10T07:00:03.498Z"), false);
  assert.equal(isSameInstant("2026-09-10T07:00:03.498Z", undefined), false);
  assert.equal(isSameInstant("not a date", "2026-09-10T07:00:03.498Z"), false);
});
