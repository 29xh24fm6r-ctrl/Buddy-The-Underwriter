/**
 * Guards the marketing-host → app-origin routing that keeps auth-requiring
 * pages from white-screening on Clerk-less domains.
 *
 * Regression: buddytheunderwriter.com/deals/<id>/credit-memo rendered the
 * banker chrome (HeroBar → useClerk) with no <ClerkProvider> — because Clerk
 * is domain-locked to app.buddytheunderwriter.com and ClerkGate refuses to
 * mount there — throwing "useClerk can only be used within <ClerkProvider>".
 * The middleware now bounces such routes to the app origin.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isMarketingHost,
  isClerkHost,
  APP_ORIGIN,
  CLERK_MARKETING_HOSTS,
} from "../clerkHosts";

test("marketing hosts are recognized (case-insensitive, port-tolerant)", () => {
  for (const host of CLERK_MARKETING_HOSTS) {
    assert.equal(isMarketingHost(host), true, `${host} should be marketing`);
    assert.equal(isClerkHost(host), false, `${host} should not be a Clerk host`);
  }
  assert.equal(isMarketingHost("BuddyTheUnderwriter.com"), true);
  assert.equal(isMarketingHost("buddytheunderwriter.com:443"), true);
});

test("the app origin and previews/localhost are NOT marketing hosts", () => {
  assert.equal(isMarketingHost("app.buddytheunderwriter.com"), false);
  assert.equal(isClerkHost("app.buddytheunderwriter.com"), true);
  assert.equal(isMarketingHost("localhost"), false);
  assert.equal(isMarketingHost("localhost:3000"), false);
  assert.equal(isMarketingHost("buddy-preview-abc.vercel.app"), false);
  // Guards against a redirect loop: the app origin must not be self-marketing.
  assert.ok(!isMarketingHost(new URL(APP_ORIGIN).hostname));
});

test("middleware redirects protected routes off marketing hosts to the app origin", () => {
  const src = readFileSync(resolve(__dirname, "../../../proxy.ts"), "utf8");
  assert.match(
    src,
    /isMarketingHost\(req\.headers\.get\("host"\)/,
    "proxy.ts must gate the redirect on the request host being a marketing host.",
  );
  assert.match(
    src,
    /NextResponse\.redirect\(target/,
    "proxy.ts must redirect marketing-host protected routes.",
  );
  // The redirect must sit AFTER the public-route early return so marketing
  // pages keep serving, and BEFORE auth()/sign-in so it can't bounce users to
  // a broken off-domain /sign-in.
  const publicReturn = src.indexOf("isPublicRoute(req)");
  const redirect = src.indexOf("isMarketingHost(req.headers");
  const authCall = src.indexOf("await auth()");
  assert.ok(publicReturn > -1 && redirect > publicReturn, "redirect must follow the public-route gate");
  assert.ok(authCall > -1 && redirect < authCall, "redirect must precede auth()");
});
