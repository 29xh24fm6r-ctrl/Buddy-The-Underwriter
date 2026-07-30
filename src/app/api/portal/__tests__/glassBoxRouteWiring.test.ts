/**
 * SPEC-M3 GLASS-BOX-1 — structural tripwire confirming the glass-box route
 * uses the same unified token resolver as its siblings (resolveBorrowerToken,
 * NOT resolvePortalContext, which is a different resolver used by a
 * separate /api/borrower/portal/[token]/* route tree — see the route's own
 * doc comment for why this distinction matters).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("TRIPWIRE: glass-box route uses resolveBorrowerToken, matching sibling /api/portal/[token]/* routes", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/app/api/portal/[token]/glass-box/route.ts"),
    "utf8",
  );
  assert.match(src, /import\s*\{\s*resolveBorrowerToken\s*\}\s*from\s*["']@\/lib\/portal\/resolveBorrowerToken["']/);
  assert.match(src, /resolveBorrowerToken\(token\)/);
  // Note: the route's own doc comment legitimately mentions
  // resolvePortalContext by name (explaining why it's NOT used here), so
  // this only checks for an actual import/call of it, not the bare word.
  assert.doesNotMatch(src, /import\s*\{[^}]*resolvePortalContext/);
  assert.match(src, /status:\s*401/);
});

test("TRIPWIRE: glass-box route delegates to buildGlassBoxReadinessRead, not inline logic", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/app/api/portal/[token]/glass-box/route.ts"),
    "utf8",
  );
  assert.match(
    src,
    /import\s*\{\s*buildGlassBoxReadinessRead\s*\}\s*from\s*["']@\/lib\/borrower\/glassBox\/buildGlassBoxReadinessRead["']/,
  );
});
