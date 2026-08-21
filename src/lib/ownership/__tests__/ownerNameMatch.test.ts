import test from "node:test";
import assert from "node:assert/strict";

import {
  clusterOwnerNames,
  compareOwnerNames,
  findOwnerNameMatch,
  normalizeOwnerName,
  ownerNameKey,
  parseOwnerName,
} from "@/lib/ownership/ownerNameMatch";

// ── The bug this module exists for ────────────────────────────────────────

test("REGRESSION b296dec2: 'matt paller' is the same person as 'Matthew Paller'", () => {
  assert.equal(compareOwnerNames("matt paller", "Matthew Paller"), "near");
  assert.equal(compareOwnerNames("Matthew Paller", "matt paller"), "near");
});

test("REGRESSION b296dec2: the old normalized key would NOT have caught it", () => {
  // Documents why the fix had to change the comparison, not just the input.
  assert.notEqual(ownerNameKey("matt paller"), ownerNameKey("Matthew Paller"));
});

test("REGRESSION b296dec2: the three real rows cluster into two people", () => {
  const rows = [
    { display_name: "Sebrina Colon" },
    { display_name: "Matthew Paller" },
    { display_name: "matt paller" },
  ];
  const clusters = clusterOwnerNames(rows);
  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters.map((c) => c.length).sort(),
    [1, 2],
  );
});

// ── Exact matching ────────────────────────────────────────────────────────

test("casing and spacing differences are exact matches", () => {
  assert.equal(compareOwnerNames("Sebrina Colon", "sebrina colon"), "exact");
  assert.equal(compareOwnerNames("Matthew  Paller", "Matthew Paller"), "exact");
  assert.equal(compareOwnerNames(" Matthew Paller ", "matthew paller"), "exact");
});

test("accents, hyphens and apostrophes normalize away", () => {
  assert.equal(normalizeOwnerName("José O'Brien-Smith"), "jose obriensmith");
  assert.equal(compareOwnerNames("José Núñez", "Jose Nunez"), "exact");
  assert.equal(compareOwnerNames("Mary O'Brien", "Mary OBrien"), "exact");
});

// ── Near matching ─────────────────────────────────────────────────────────

test("prefix shortenings of the given name match", () => {
  assert.equal(compareOwnerNames("Deb Colon", "Debra Colon"), "near");
  assert.equal(compareOwnerNames("Chris Nolan", "Christopher Nolan"), "near");
});

test("known nicknames that are not prefixes match", () => {
  assert.equal(compareOwnerNames("Bill Gates", "William Gates"), "near");
  assert.equal(compareOwnerNames("Peggy Olson", "Margaret Olson"), "near");
  assert.equal(compareOwnerNames("Jack Donaghy", "John Donaghy"), "near");
});

test("middle names and generational suffixes do not split a person", () => {
  assert.equal(compareOwnerNames("Matthew J Paller", "Matthew Paller"), "near");
  assert.equal(compareOwnerNames("Matthew Paller Jr", "Matthew Paller"), "near");
  // "near", not "exact": the raw strings still differ, so the UI gets a
  // chance to confirm rather than silently dropping the title.
  assert.equal(compareOwnerNames("Dr. Matthew Paller", "Matthew Paller"), "near");
});

// ── Where it must NOT match (the false-merge guardrails) ──────────────────

test("siblings sharing a surname stay separate", () => {
  assert.equal(compareOwnerNames("Michael Paller", "Matthew Paller"), null);
  assert.equal(compareOwnerNames("Sebrina Colon", "Sabrina Colon"), null);
});

test("a bare initial never absorbs a full given name", () => {
  // This is the whole reason for the 3-character prefix floor: without it,
  // "M Paller" would merge Matthew AND Michael into one owner.
  assert.equal(compareOwnerNames("M Paller", "Matthew Paller"), null);
  assert.equal(compareOwnerNames("M. Paller", "Michael Paller"), null);
});

test("different surnames never match", () => {
  assert.equal(compareOwnerNames("Matt Paller", "Matt Colon"), null);
  assert.equal(compareOwnerNames("Matthew Paller", "Matthew Pallerson"), null);
});

test("empty and whitespace-only names match nothing", () => {
  assert.equal(compareOwnerNames("", "Matthew Paller"), null);
  assert.equal(compareOwnerNames("   ", "Matthew Paller"), null);
  assert.equal(compareOwnerNames(null, undefined), null);
});

test("single-token names only compare with other single-token names", () => {
  assert.equal(compareOwnerNames("Cher", "Cher"), "exact");
  assert.equal(compareOwnerNames("Cheryl", "Cher"), "near");
  assert.equal(compareOwnerNames("Cher", "Cher Bono"), null);
});

// ── parseOwnerName ────────────────────────────────────────────────────────

test("parseOwnerName splits given / middle / family", () => {
  const parts = parseOwnerName("Dr. Matthew J. Paller Jr");
  assert.equal(parts.given, "matthew");
  assert.equal(parts.family, "paller");
  assert.deepEqual(parts.middle, ["j"]);
});

test("a lone suffix-looking name is not erased", () => {
  assert.equal(parseOwnerName("Iv").given, "iv");
});

// ── findOwnerNameMatch ────────────────────────────────────────────────────

test("an exact match wins over a near match regardless of order", () => {
  const rows = [{ display_name: "matt paller" }, { display_name: "Matthew Paller" }];
  const match = findOwnerNameMatch("Matthew Paller", rows);
  assert.equal(match?.kind, "exact");
  assert.equal(match?.row.display_name, "Matthew Paller");
});

test("among near matches the first row wins, so repeats converge", () => {
  // Both rows are the same person as the candidate. Picking the first one
  // every time is what stops a re-run ping-ponging between two duplicates
  // that already exist.
  const rows = [{ display_name: "Matt Paller" }, { display_name: "Matthew J Paller" }];
  const first = findOwnerNameMatch("Matthew Paller", rows);
  const second = findOwnerNameMatch("Matthew Paller", rows);
  assert.equal(first?.kind, "near");
  assert.equal(first?.row.display_name, "Matt Paller");
  assert.equal(second?.row.display_name, "Matt Paller");
});

test("a nickname that is not a prefix and not in the table does not match", () => {
  // "matty" is not a prefix of "matthew" and is not in NICKNAME_GROUPS, so
  // the module declines rather than guessing. Documented because it is a
  // deliberate limit, not an oversight.
  assert.equal(compareOwnerNames("matty paller", "Matthew Paller"), null);
});

test("no match returns null rather than a wrong row", () => {
  assert.equal(findOwnerNameMatch("Sebrina Colon", [{ display_name: "Matthew Paller" }]), null);
  assert.equal(findOwnerNameMatch("Anyone", []), null);
});
