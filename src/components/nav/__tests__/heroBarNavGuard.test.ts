import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

function readSource(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

const heroBar = readSource("src/components/nav/HeroBar.tsx");
const heroBarGrouped = readSource("src/components/nav/HeroBarGrouped.tsx");
const heroBarAdapted = readSource("src/components/nav/HeroBarAdapted.tsx");

// ---------------------------------------------------------------------------
// SPEC — Deal-Scoped Credit Memo Navigation Guards
// ---------------------------------------------------------------------------

test("HeroBar does not have a static /credit-memo href", () => {
  // Should not have a hardcoded { href: "/credit-memo" } in a const array
  assert.ok(
    !heroBar.includes('href: "/credit-memo"'),
    'HeroBar must not have static href="/credit-memo" — must use deal-scoped routing',
  );
});

test("HeroBar extracts dealId from pathname for deal-scoped links", () => {
  assert.match(heroBar, /extractDealId/);
  assert.match(heroBar, /activeDealId/);
});

test("HeroBar generates deal-scoped credit-memo link when dealId is present", () => {
  // The code must construct /deals/${activeDealId}/credit-memo
  assert.match(heroBar, /credit-memo/);
  assert.match(heroBar, /dealSuffix.*credit-memo|`\/deals\/\$\{activeDealId\}\/credit-memo`/);
});

test("HeroBarGrouped does not have a static /credit-memo href", () => {
  assert.ok(
    !heroBarGrouped.includes('{ href: "/credit-memo"'),
    'HeroBarGrouped must not have static href="/credit-memo"',
  );
});

test("HeroBarGrouped generates deal-scoped credit-memo link", () => {
  assert.match(heroBarGrouped, /dealHref.*credit-memo/);
  assert.match(heroBarGrouped, /extractDealId/);
});

test("HeroBarAdapted includes credit-memo in deal-level navigation", () => {
  assert.match(heroBarAdapted, /\/deals\/\$\{dealId\}\/credit-memo/);
});

test("all three HeroBars scope Underwrite and Pricing to active deal too", () => {
  // HeroBar
  assert.match(heroBar, /dealSuffix.*underwrite/);
  assert.match(heroBar, /dealSuffix.*pricing/);
  // HeroBarGrouped
  assert.match(heroBarGrouped, /dealHref.*underwrite/);
  assert.match(heroBarGrouped, /dealHref.*pricing/);
  // HeroBarAdapted
  assert.match(heroBarAdapted, /\/deals\/\$\{dealId\}\/underwrite/);
});
