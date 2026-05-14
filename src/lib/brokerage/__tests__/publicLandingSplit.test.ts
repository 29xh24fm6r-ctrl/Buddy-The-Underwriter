import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// Brokerage landing
const brokeragePage = read("src/components/marketing/BrokerageLandingPage.tsx");

test("brokerage copy includes $1,000", () => {
  assert.ok(brokeragePage.includes("$1,000"), "Must disclose $1,000 packaging fee");
});

test("brokerage copy has no approval guarantee", () => {
  assert.ok(
    brokeragePage.includes("does not guarantee"),
    "Must include no-guarantee disclaimer",
  );
  assert.ok(
    !brokeragePage.toLowerCase().includes("guaranteed approval"),
    "Must not promise guaranteed approval",
  );
});

test("brokerage CTA points to /apply", () => {
  assert.ok(brokeragePage.includes('"/apply"'), "Primary CTA must link to /apply");
});

// Underwriter landing
const underwriterPage = read("src/components/marketing/UnderwriterLandingPage.tsx");

test("underwriter copy does not mention borrower packaging fee", () => {
  assert.ok(
    !underwriterPage.includes("$1,000"),
    "Underwriter page must not mention $1,000 borrower fee",
  );
  assert.ok(
    !underwriterPage.toLowerCase().includes("packaging fee"),
    "Underwriter page must not mention packaging fee",
  );
});

test("underwriter CTA does not point to borrower portal", () => {
  assert.ok(
    !underwriterPage.includes('"/apply"'),
    "Underwriter CTA must not link to /apply",
  );
  assert.ok(
    !underwriterPage.includes('"/start"'),
    "Underwriter CTA must not link to /start",
  );
  assert.ok(
    !underwriterPage.includes('"/portal"'),
    "Underwriter CTA must not link to /portal",
  );
});

// Homepage brand split
const homepage = read("src/components/marketing/BrandSplitPage.tsx");

test("homepage links to /brokerage and /underwriter", () => {
  assert.ok(homepage.includes('"/brokerage"'), "Must link to /brokerage");
  assert.ok(homepage.includes('"/underwriter"'), "Must link to /underwriter");
});

test("homepage distinguishes borrower and lender audiences", () => {
  assert.ok(
    homepage.toLowerCase().includes("business owner") || homepage.toLowerCase().includes("borrower"),
    "Must address business owners/borrowers",
  );
  assert.ok(
    homepage.toLowerCase().includes("bank") || homepage.toLowerCase().includes("lender"),
    "Must address banks/lenders",
  );
});
