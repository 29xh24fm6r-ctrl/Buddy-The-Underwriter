import test from "node:test";
import assert from "node:assert/strict";

import {
  toHttpsUrl,
  extractTitle,
  fetchBorrowerWebsiteSnapshot,
} from "@/lib/research/sourceSnapshot";

/**
 * SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1
 */

test("[snapshot] toHttpsUrl normalizes + rejects junk", () => {
  assert.equal(toHttpsUrl("omnicare365.com"), "https://omnicare365.com/");
  assert.equal(toHttpsUrl("http://omnicare365.com/x"), "https://omnicare365.com/x");
  assert.equal(toHttpsUrl(""), null);
  assert.equal(toHttpsUrl(null), null);
  // hostname with spaces is invalid → null
  assert.equal(toHttpsUrl("not a url with spaces"), null);
});

test("[snapshot] extractTitle pulls <title>", () => {
  assert.equal(extractTitle("<html><head><title> OmniCare 365 </title></head></html>"), "OmniCare 365");
  assert.equal(extractTitle("<html>no title</html>"), null);
});

function mockResponse(status: number, html: string, contentType = "text/html") {
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    body: null, // forces the text() fallback path in readCapped
    text: async () => html,
  } as unknown as Response;
}

test("[snapshot] 200 HTML → collected with hash + title", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => mockResponse(200, "<title>OmniCare 365</title>")) as any;
  try {
    const s = await fetchBorrowerWebsiteSnapshot("omnicare365.com", "omnicare365.com");
    assert.equal(s.ok, true);
    assert.equal(s.status, "collected");
    assert.equal(s.http_status, 200);
    assert.equal(s.title, "OmniCare 365");
    assert.ok(s.content_hash && s.content_hash.length === 64);
    assert.equal(s.error, null);
  } finally {
    globalThis.fetch = orig;
  }
});

test("[snapshot] non-200 → failed", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => mockResponse(404, "nope")) as any;
  try {
    const s = await fetchBorrowerWebsiteSnapshot("omnicare365.com", "omnicare365.com");
    assert.equal(s.ok, false);
    assert.equal(s.status, "failed");
    assert.equal(s.http_status, 404);
    assert.match(s.error ?? "", /HTTP 404/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("[snapshot] domain mismatch → failed, no fetch", async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return mockResponse(200, "x"); }) as any;
  try {
    const s = await fetchBorrowerWebsiteSnapshot("https://evil.example.com", "omnicare365.com");
    assert.equal(s.status, "failed");
    assert.match(s.error ?? "", /domain mismatch/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = orig;
  }
});

test("[snapshot] fetch throws → failed (never throws past boundary)", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("boom"); }) as any;
  try {
    const s = await fetchBorrowerWebsiteSnapshot("omnicare365.com", "omnicare365.com");
    assert.equal(s.status, "failed");
    assert.equal(s.error, "boom");
  } finally {
    globalThis.fetch = orig;
  }
});

test("[snapshot] no website → failed with reason, no throw", async () => {
  const s = await fetchBorrowerWebsiteSnapshot(null, null);
  assert.equal(s.status, "failed");
  assert.match(s.error ?? "", /no usable website/);
});
