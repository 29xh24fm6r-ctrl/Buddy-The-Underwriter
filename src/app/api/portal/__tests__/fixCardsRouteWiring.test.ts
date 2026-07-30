/**
 * SPEC-M4 FIX-CARDS-1 — structural tripwire confirming the fix-cards route
 * uses the same unified token resolver as its siblings, and wires the
 * doc_request_round dedup correctly. Same convention as
 * glassBoxRouteWiring.test.ts (M3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRoute(): string {
  return readFileSync(resolve(process.cwd(), "src/app/api/portal/[token]/fix-cards/route.ts"), "utf8");
}

test("TRIPWIRE: fix-cards route uses resolveBorrowerToken, matching sibling /api/portal/[token]/* routes", () => {
  const src = readRoute();
  assert.match(src, /import\s*\{\s*resolveBorrowerToken\s*\}\s*from\s*["']@\/lib\/portal\/resolveBorrowerToken["']/);
  assert.match(src, /resolveBorrowerToken\(token\)/);
  assert.match(src, /status:\s*401/);
});

test("TRIPWIRE: fix-cards route delegates to buildFixCards and dedupes via gapKeySetChanged before emitting", () => {
  const src = readRoute();
  assert.match(
    src,
    /import\s*\{\s*buildFixCards[^}]*\}\s*from\s*["']@\/lib\/borrower\/fixCards\/buildFixCards["']/,
  );
  assert.match(
    src,
    /import\s*\{\s*gapKeySetChanged\s*\}\s*from\s*["']@\/lib\/brokerage\/dedupeDocRequestRound["']/,
  );
  assert.match(src, /gapKeySetChanged\(gapKeys, lastGapKeys\)/);
  assert.match(src, /emitDocRequestRound\(dealId, cards\.length, sb, \{ gapKeys \}\)/);
});

test("TRIPWIRE: a doc_request_round failure must not fail the whole route", () => {
  const src = readRoute();
  // The emit call is wrapped in its own try/catch, separate from the outer one.
  const emitIdx = src.indexOf("maybeEmitDocRequestRound(dealId, cards, sb)");
  assert.ok(emitIdx > -1);
  const tryIdx = src.lastIndexOf("try {", emitIdx);
  const catchIdx = src.indexOf("} catch", emitIdx);
  assert.ok(tryIdx > -1 && tryIdx < emitIdx);
  assert.ok(catchIdx > emitIdx);
});
