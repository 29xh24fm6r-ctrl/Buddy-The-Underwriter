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
const resolver = readSource("src/lib/navigation/resolveDealScopedRoute.ts");

// ---------------------------------------------------------------------------
// resolveDealScopedRoute unit tests
// ---------------------------------------------------------------------------

// Import the pure function directly for behavioral tests
import {
  resolveDealScopedRoute,
  extractDealIdFromPath,
} from "@/lib/navigation/resolveDealScopedRoute";

test("extractDealIdFromPath extracts UUID from /deals/[uuid]/...", () => {
  assert.equal(
    extractDealIdFromPath("/deals/0279ed32-abcd-1234-5678-1234567890ab/cockpit"),
    "0279ed32-abcd-1234-5678-1234567890ab",
  );
});

test("extractDealIdFromPath returns null for /deals", () => {
  assert.equal(extractDealIdFromPath("/deals"), null);
});

test("resolveDealScopedRoute: inside deal → scoped href", () => {
  const res = resolveDealScopedRoute({
    pathname: "/deals/abc12345-0000-0000-0000-000000000000/cockpit",
    target: "credit-memo",
  });
  assert.equal(res.href, "/deals/abc12345-0000-0000-0000-000000000000/credit-memo");
  assert.equal(res.requiresDealSelection, false);
});

test("resolveDealScopedRoute: outside deal with lastDealId → last deal href", () => {
  const res = resolveDealScopedRoute({
    pathname: "/deals",
    target: "credit-memo",
    lastDealId: "abc12345-0000-0000-0000-000000000000",
  });
  assert.equal(res.href, "/deals/abc12345-0000-0000-0000-000000000000/credit-memo");
  assert.equal(res.requiresDealSelection, false);
});

test("resolveDealScopedRoute: outside deal without lastDealId → requires selection", () => {
  const res = resolveDealScopedRoute({
    pathname: "/deals",
    target: "credit-memo",
  });
  assert.equal(res.href, null);
  assert.equal(res.requiresDealSelection, true);
});

test("resolveDealScopedRoute: never returns /deals as href", () => {
  const cases = [
    { pathname: "/deals", target: "credit-memo" as const },
    { pathname: "/deals", target: "pricing" as const },
    { pathname: "/deals", target: "underwrite" as const },
  ];
  for (const c of cases) {
    const res = resolveDealScopedRoute(c);
    assert.ok(
      res.href === null || res.href.includes("/deals/") && res.href.length > 7,
      `resolveDealScopedRoute must never return bare /deals — got ${res.href}`,
    );
  }
});

// ---------------------------------------------------------------------------
// HeroBar source guards
// ---------------------------------------------------------------------------

test("HeroBar does not have a static /credit-memo href", () => {
  assert.ok(!heroBar.includes('href: "/credit-memo"'));
});

test("HeroBar uses resolveDealScopedRoute for deal-scoped nav", () => {
  assert.match(heroBar, /resolveDealScopedRoute/);
});

test("HeroBar shows DealPickerModal when no deal context", () => {
  assert.match(heroBar, /DealPickerModal/);
  assert.match(heroBar, /pickerTarget/);
});

test("HeroBar persists lastDealId on deal page visit", () => {
  assert.match(heroBar, /setLastDealId/);
});

test("HeroBarGrouped uses resolveDealScopedRoute", () => {
  assert.match(heroBarGrouped, /resolveDealScopedRoute/);
  assert.match(heroBarGrouped, /DealPickerModal/);
});

test("HeroBarAdapted includes credit-memo in deal-level navigation", () => {
  assert.match(heroBarAdapted, /\/deals\/\$\{dealId\}\/credit-memo/);
  assert.match(heroBarAdapted, /DealPickerModal/);
});

test("no HeroBar silently routes Credit Memo to /deals", () => {
  // The old pattern: { href: "/deals", label: "Credit Memo" } must not exist
  for (const [name, source] of [["HeroBar", heroBar], ["HeroBarGrouped", heroBarGrouped], ["HeroBarAdapted", heroBarAdapted]]) {
    assert.ok(
      !source.includes('href: "/deals", label: "Credit Memo"'),
      `${name} still has Credit Memo → /deals`,
    );
    assert.ok(
      !source.includes("href: \"/deals\", label: \"Credit Memo\""),
      `${name} still has Credit Memo → /deals (double-quote)`,
    );
  }
});
