import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithDiagnostics, isHtml } from "../_http.mjs";
import { probeAuthHeaders, resolveMeta } from "../verify-underwrite.mjs";

test("resolveMeta falls back to /api/meta", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);
    if (url.endsWith("/api/meta/build")) {
      return new Response("<html>not found</html>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(JSON.stringify({ git: { sha: "abc123" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await resolveMeta({
    baseUrl: "https://example.com",
    fetchImpl,
    secrets: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.com/api/meta");
  assert.equal(result.payload?.git?.sha, "abc123");
  assert.equal(calls.length, 2);
});

test("probeAuthHeaders selects Authorization when required", async () => {
  const fetchImpl = async (_url: RequestInfo | URL, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    const auth = headers.get("authorization");
    if (!auth) {
      return new Response(JSON.stringify({ ok: false }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await probeAuthHeaders({
    url: "https://example.com/api/builder/token/status",
    token: "secret-token",
    fetchImpl,
    secrets: ["secret-token"],
  });

  assert.equal(result.mode, "authorization");
  assert.equal(result.headers?.Authorization, "Bearer secret-token");
  assert.equal(result.tokenStatus?.ok, true);
});

test("fetchWithDiagnostics redacts secrets", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  const result = await fetchWithDiagnostics(
    "https://example.com",
    { headers: { "x-buddy-builder-token": "secret-token" } },
    { fetchImpl, secrets: ["secret-token"] }
  );

  assert.equal(result.diag.requestHeaders["x-buddy-builder-token"], "[REDACTED]");
});

test("isHtml detects html responses", () => {
  const res = new Response("<html></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });

  assert.equal(isHtml("<html></html>", res), true);
});
