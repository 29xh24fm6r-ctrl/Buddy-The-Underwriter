/**
 * SPEC-M4 FIX-CARDS-1 — structural tripwire confirming the refreshKey
 * plumbing actually connects PortalClient's checklist-affecting actions to
 * GlassBoxPanel/FixCardsPanel, closing the "completing a card visibly
 * updates the Glass Box" program requirement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readFile(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

test("TRIPWIRE: PortalClient bumps refreshKey after every checklist-refresh call site", () => {
  const src = readFile("src/components/borrower/PortalClient.tsx");
  assert.match(src, /const \[refreshKey, setRefreshKey\] = React\.useState\(0\)/);
  assert.match(src, /const bumpRefreshKey = React\.useCallback/);

  const bumpCount = (src.match(/bumpRefreshKey\(\)/g) ?? []).length;
  // Called at each of the 3 known checklist-affecting call sites in this file.
  assert.ok(bumpCount >= 3, `expected at least 3 bumpRefreshKey() call sites, found ${bumpCount}`);

  assert.match(src, /refreshKey=\{refreshKey\}/);
});

test("TRIPWIRE: BorrowerFundingJourney threads refreshKey into both GlassBoxPanel and FixCardsPanel", () => {
  const src = readFile("src/components/borrower/BorrowerFundingJourney.tsx");
  assert.match(src, /import\s*\{\s*FixCardsPanel\s*\}\s*from\s*["']\.\/fix-cards\/FixCardsPanel["']/);
  assert.match(src, /<GlassBoxPanel token=\{portalToken\} refreshKey=\{refreshKey\}\s*\/>/);
  assert.match(src, /<FixCardsPanel token=\{portalToken\} refreshKey=\{refreshKey\}\s*\/>/);
});

test("TRIPWIRE: GlassBoxPanel's fetch effect depends on refreshKey, not just token", () => {
  const src = readFile("src/components/borrower/glass-box/GlassBoxPanel.tsx");
  assert.match(src, /\}, \[token, refreshKey\]\);/);
});

test("TRIPWIRE: FixCardsPanel's fetch effect depends on refreshKey, not just token", () => {
  const src = readFile("src/components/borrower/fix-cards/FixCardsPanel.tsx");
  assert.match(src, /\}, \[token, refreshKey\]\);/);
});
