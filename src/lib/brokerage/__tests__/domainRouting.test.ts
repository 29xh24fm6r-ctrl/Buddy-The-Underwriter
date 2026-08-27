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
  getPublicProductRedirect,
  PUBLIC_PRODUCT_ORIGINS,
} = require("../domainRouting") as typeof import("../domainRouting");

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

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

test("canonical URLs use the final www hosts", () => {
  assert.equal(PUBLIC_PRODUCT_ORIGINS.brokerage, "https://www.buddysba.com");
  assert.equal(PUBLIC_PRODUCT_ORIGINS.underwriter, "https://www.buddytheunderwriter.com");
  assert.equal(getCanonicalUrl("buddysba.com", "/"), "https://www.buddysba.com/");
  assert.equal(getCanonicalUrl("buddysba.com", "/apply"), "https://www.buddysba.com/apply");
  assert.equal(getCanonicalUrl("buddytheunderwriter.com", "/"), "https://www.buddytheunderwriter.com/");
  assert.equal(getCanonicalUrl("localhost:3000", "/"), "https://www.buddysba.com/");
});

test("cross-product entries redirect to the product's canonical host", () => {
  assert.equal(
    getPublicProductRedirect("www.buddysba.com", "/underwriter"),
    "https://www.buddytheunderwriter.com/",
  );
  assert.equal(
    getPublicProductRedirect("buddysba.com:443", "/underwriter/"),
    "https://www.buddytheunderwriter.com/",
  );
  assert.equal(
    getPublicProductRedirect("www.buddytheunderwriter.com", "/brokerage"),
    "https://www.buddysba.com/",
  );
});

test("cross-product redirect does not affect previews or same-product routes", () => {
  assert.equal(getPublicProductRedirect("localhost:3000", "/underwriter"), null);
  assert.equal(getPublicProductRedirect("buddy-preview.vercel.app", "/underwriter"), null);
  assert.equal(getPublicProductRedirect("www.buddysba.com", "/brokerage"), null);
  assert.equal(getPublicProductRedirect("www.buddytheunderwriter.com", "/underwriter"), null);
  assert.equal(getPublicProductRedirect("www.buddysba.com", "/apply"), null);
});

test("metadata differs by product", () => {
  const brk = getMetadataForProduct("brokerage");
  assert.ok(brk.title.includes("Buddy SBA"));
  assert.ok(brk.description.includes("SBA loan package"));

  const uw = getMetadataForProduct("underwriter");
  assert.ok(uw.title.includes("Buddy The Underwriter"));
  assert.ok(uw.description.includes("underwriting"));
});

const brokeragePage = read("src/components/marketing/BrokerageLandingPage.tsx");
const underwriterPage = read("src/components/marketing/UnderwriterLandingPage.tsx");

test("brokerage fee disclosure only on BuddySBA surface", () => {
  assert.ok(brokeragePage.includes("$1,000"));
  assert.ok(!underwriterPage.includes("$1,000"));
  assert.ok(!underwriterPage.toLowerCase().includes("packaging fee"));
});

test("underwriter borrower cross-nav uses the canonical Buddy SBA host", () => {
  assert.ok(underwriterPage.includes("borrower-cross-nav"));
  assert.ok(underwriterPage.includes('"https://www.buddysba.com/"'));
  assert.ok(!underwriterPage.includes('href="/brokerage"'));
});

test("brokerage lender cross-nav uses the canonical underwriter host", () => {
  assert.ok(brokeragePage.includes("bank-platform-entry"));
  assert.ok(brokeragePage.includes('"https://www.buddytheunderwriter.com/"'));
  assert.ok(!brokeragePage.includes('href="/underwriter"'));
});

const proxy = read("src/proxy.ts");

test("middleware rewrites the underwriter root to /underwriter", () => {
  assert.ok(proxy.includes("buddytheunderwriter"));
  assert.ok(proxy.includes("/underwriter"));
});

test("middleware redirects buddybrokerage.com", () => {
  assert.ok(proxy.includes("buddybrokerage"));
  assert.ok(proxy.includes("buddysba.com"));
  assert.ok(proxy.includes("301"));
});

test("cross-product redirect runs before the public-route short circuit", () => {
  const redirectIndex = proxy.indexOf("const publicProductRedirect");
  const publicReturnIndex = proxy.indexOf("isPublicRoute(req)");
  assert.ok(redirectIndex >= 0);
  assert.ok(publicReturnIndex >= 0);
  assert.ok(redirectIndex < publicReturnIndex);
  assert.ok(proxy.includes("NextResponse.redirect(target, 308)"));
});
