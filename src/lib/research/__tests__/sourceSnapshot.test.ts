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

test("[snapshot] 403 to the identified client → one retry with a browser profile → collected", async () => {
  // Production deal c0f6caab: the borrower's host answered 403 to
  // "BuddyTheUnderwriter/1.0" on every mission since 2026-08-31.
  const orig = globalThis.fetch;
  const agents: string[] = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    const ua = String(init?.headers?.["User-Agent"] ?? "");
    agents.push(ua);
    return ua.startsWith("BuddyTheUnderwriter")
      ? mockResponse(403, "<title>403 Forbidden</title>")
      : mockResponse(200, "<title>Buff Guys Mobile Detailing</title>");
  }) as any;
  try {
    const snap = await fetchBorrowerWebsiteSnapshot("https://www.ceramiccoatingandppf.com/", "ceramiccoatingandppf.com");
    assert.equal(snap.status, "collected");
    assert.equal(snap.http_status, 200);
    assert.equal(snap.title, "Buff Guys Mobile Detailing");
    assert.equal(agents.length, 2);
    assert.ok(agents[0].startsWith("BuddyTheUnderwriter"), "identifies honestly first");
    assert.ok(agents[1].startsWith("Mozilla/5.0"), "retries with a browser profile");
  } finally {
    globalThis.fetch = orig;
  }
});

test("[snapshot] a plain 404 is not retried", async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return mockResponse(404, "nope"); }) as any;
  try {
    const snap = await fetchBorrowerWebsiteSnapshot("https://example.com/", "example.com");
    assert.equal(snap.status, "failed");
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }
});
