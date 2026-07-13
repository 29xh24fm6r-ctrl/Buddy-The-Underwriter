import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const inputs = require("../inputs") as typeof import("../inputs");
const { deriveCharacterFlagsFromOwners } = inputs;

type Owner = {
  convicted_or_pleaded: boolean | null;
  on_parole_or_probation: boolean | null;
};

function owner(overrides: Partial<Owner> = {}): Owner {
  return { convicted_or_pleaded: null, on_parole_or_probation: null, ...overrides };
}

test("no owners -> both flags null (nothing to derive from)", () => {
  const result = deriveCharacterFlagsFromOwners([]);
  assert.equal(result.felonyConviction, null);
  assert.equal(result.incarceratedOrParole, null);
});

test("single owner, both explicitly false -> both flags false", () => {
  const result = deriveCharacterFlagsFromOwners([
    owner({ convicted_or_pleaded: false, on_parole_or_probation: false }),
  ]);
  assert.equal(result.felonyConviction, false);
  assert.equal(result.incarceratedOrParole, false);
});

test("any owner true -> flag true even if others are false", () => {
  const result = deriveCharacterFlagsFromOwners([
    owner({ convicted_or_pleaded: false, on_parole_or_probation: false }),
    owner({ convicted_or_pleaded: true, on_parole_or_probation: false }),
  ]);
  assert.equal(result.felonyConviction, true);
  assert.equal(result.incarceratedOrParole, false);
});

test("mix of false and undisclosed (null) -> pending null, not a false pass", () => {
  const result = deriveCharacterFlagsFromOwners([
    owner({ convicted_or_pleaded: false, on_parole_or_probation: null }),
  ]);
  assert.equal(result.felonyConviction, false);
  assert.equal(result.incarceratedOrParole, null);
});

test("all owners undisclosed -> both flags null", () => {
  const result = deriveCharacterFlagsFromOwners([owner(), owner()]);
  assert.equal(result.felonyConviction, null);
  assert.equal(result.incarceratedOrParole, null);
});

test("true wins even alongside an undisclosed owner", () => {
  const result = deriveCharacterFlagsFromOwners([
    owner({ on_parole_or_probation: true }),
    owner(),
  ]);
  assert.equal(result.incarceratedOrParole, true);
  assert.equal(result.felonyConviction, null);
});
