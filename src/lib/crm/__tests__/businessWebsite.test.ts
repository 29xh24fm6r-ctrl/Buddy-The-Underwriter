import assert from "node:assert/strict";
import test from "node:test";

import {
  businessLogoUrl,
  businessWebsiteDomain,
  normalizeBusinessWebsite,
} from "../businessWebsite";

test("normalizes a business domain into a secure canonical URL", () => {
  assert.equal(normalizeBusinessWebsite("rocavaka.com"), "https://rocavaka.com");
  assert.equal(normalizeBusinessWebsite("http://www.rocavaka.com/"), "https://www.rocavaka.com");
});

test("rejects values that are not public-looking website domains", () => {
  assert.equal(normalizeBusinessWebsite("not a website"), null);
  assert.equal(normalizeBusinessWebsite("javascript:alert(1)"), null);
  assert.equal(normalizeBusinessWebsite(""), null);
});

test("derives a display domain and deterministic business mark URL", () => {
  assert.equal(businessWebsiteDomain("https://www.rocavaka.com/about"), "rocavaka.com");
  assert.equal(
    businessLogoUrl("rocavaka.com"),
    "https://www.google.com/s2/favicons?domain=rocavaka.com&sz=128",
  );
});
