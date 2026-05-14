import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const {
  resolveProductFromHost,
  shouldRedirectBuddyBrokerage,
  getCanonicalUrl,
  getMetadataForProduct,
} = require("../domainRouting") as typeof import("../domainRouting");

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

// Domain routing logic

test("buddysba.com resolves to brokerage", () => {
  assert.equal(resolveProductFromHost("buddysba.com"), "brokerage");
  assert.equal(resolveProductFromHost("www.buddysba.com"), "brokerage");
  assert.equal(resolveProductFromHost("BuddySBA.com:3000"), "brokerage");
});

test("buddytheunderwriter.com resolves to underwriter", () => {
  assert.equal(resolveProductFromHost("buddytheunderwriter.com"), "underwriter");
  assert.equal(resolveProductFromHost("www.buddytheunderwriter.com"), "underwriter");
});

test("localhost defaults to brokerage", () => {
  assert.equal(resolveProductFromHost("localhost:3000"), "brokerage");
  assert.equal(resolveProductFromHost(null), "brokerage");
  assert.equal(resolveProductFromHost(""), "brokerage");
});

test("buddybrokerage.com should redirect", () => {
  assert.equal(shouldRedirectBuddyBrokerage("buddybrokerage.com"), true);
  assert.equal(shouldRedirectBuddyBrokerage("www.buddybrokerage.com"), true);
  assert.equal(shouldRedirectBuddyBrokerage("buddysba.com"), false);
  assert.equal(shouldRedirectBuddyBrokerage(null), false);
});

test("canonical URLs correct by host", () => {
  assert.equal(getCanonicalUrl("buddysba.com", "/"), "https://buddysba.com/");
  assert.equal(getCanonicalUrl("buddysba.com", "/apply"), "https://buddysba.com/apply");
  assert.equal(getCanonicalUrl("buddytheunderwriter.com", "/"), "https://buddytheunderwriter.com/");
  assert.equal(getCanonicalUrl("localhost:3000", "/"), "https://buddysba.com/");
});

test("metadata differs by product", () => {
  const brk = getMetadataForProduct("brokerage");
  assert.ok(brk.title.includes("Buddy SBA"));
  assert.ok(brk.description.includes("SBA loan package"));

  const uw = getMetadataForProduct("underwriter");
  assert.ok(uw.title.includes("Buddy The Underwriter"));
  assert.ok(uw.description.includes("underwriting"));
});

// Content boundary checks

const brokeragePage = read("src/components/marketing/BrokerageLandingPage.tsx");
const underwriterPage = read("src/components/marketing/UnderwriterLandingPage.tsx");

test("brokerage fee disclosure only on BuddySBA surface", () => {
  assert.ok(brokeragePage.includes("$1,000"));
  assert.ok(!underwriterPage.includes("$1,000"));
  assert.ok(!underwriterPage.toLowerCase().includes("packaging fee"));
});

test("underwriter has borrower cross-nav", () => {
  assert.ok(underwriterPage.includes("borrower-cross-nav"));
  assert.ok(underwriterPage.includes('"/brokerage"'));
});

test("brokerage has bank cross-nav", () => {
  assert.ok(brokeragePage.includes("bank-platform-entry"));
  assert.ok(brokeragePage.includes('"/underwriter"'));
});

// Middleware integration

const proxy = read("src/proxy.ts");

test("middleware rewrites underwriter domain to /underwriter", () => {
  assert.ok(proxy.includes("buddytheunderwriter"));
  assert.ok(proxy.includes("/underwriter"));
});

test("middleware redirects buddybrokerage.com", () => {
  assert.ok(proxy.includes("buddybrokerage"));
  assert.ok(proxy.includes("buddysba.com"));
  assert.ok(proxy.includes("301"));
});

test("middleware has /brokerage and /underwriter as public routes", () => {
  assert.ok(proxy.includes('"/brokerage(.*)"'));
  assert.ok(proxy.includes('"/underwriter(.*)"'));
});
