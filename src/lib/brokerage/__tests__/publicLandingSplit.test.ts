import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// Homepage = BrokerageLandingPage (brokerage-first)
const homepage = read("src/components/marketing/BrokerageLandingPage.tsx");
const homepageRoute = read("src/app/page.tsx");

test("homepage primary headline mentions Buddy Brokerage", () => {
  assert.ok(
    homepage.includes("Buddy Brokerage"),
    "Homepage hero must say Buddy Brokerage",
  );
});

test("homepage primary CTA points to /apply", () => {
  assert.ok(homepage.includes('"/apply"'), "Primary CTA must link to /apply");
});

test("homepage includes $1,000 fee disclosure", () => {
  assert.ok(homepage.includes("$1,000"), "Must disclose $1,000 packaging fee");
});

test("homepage includes no-guarantee language", () => {
  assert.ok(
    homepage.includes("does not guarantee"),
    "Must include no-guarantee disclaimer",
  );
});

test("homepage includes secondary bank/lender section", () => {
  assert.ok(
    homepage.includes("bank-platform-entry"),
    "Must have a bank platform entry section",
  );
  assert.ok(
    homepage.toLowerCase().includes("for banks") || homepage.toLowerCase().includes("sba lenders"),
    "Must address banks/lenders in secondary section",
  );
});

test("homepage links to /underwriter", () => {
  assert.ok(homepage.includes('"/underwriter"'), "Must link to /underwriter");
});

test("homepage does not present Brokerage and Underwriter as equal primary cards", () => {
  assert.ok(
    homepageRoute.includes("BrokerageLandingPage"),
    "Homepage must use BrokerageLandingPage, not BrandSplitPage",
  );
  assert.ok(
    !homepageRoute.includes("BrandSplitPage"),
    "Homepage must not use the equal-cards BrandSplitPage",
  );
});

// /underwriter still exists and stays bank-facing
const underwriterPage = read("src/components/marketing/UnderwriterLandingPage.tsx");

test("/underwriter still exists and is bank-facing", () => {
  assert.ok(
    underwriterPage.includes("Buddy The Underwriter"),
    "Underwriter page must exist",
  );
  assert.ok(
    !underwriterPage.includes("$1,000"),
    "Underwriter must not mention $1,000 borrower fee",
  );
  assert.ok(
    !underwriterPage.toLowerCase().includes("packaging fee"),
    "Underwriter must not mention packaging fee",
  );
});

// /brokerage still exists and stays borrower-facing
const brokeragePage = read("src/app/brokerage/page.tsx");

test("/brokerage still exists and is borrower-facing", () => {
  assert.ok(
    brokeragePage.includes("BrokerageLandingPage"),
    "/brokerage must render BrokerageLandingPage",
  );
});
