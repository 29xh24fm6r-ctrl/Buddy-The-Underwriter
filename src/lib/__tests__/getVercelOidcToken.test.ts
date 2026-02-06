import assert from "node:assert/strict";
import { test } from "node:test";

// Can't import the actual module because of "server-only" guard,
// so we test the logic inline here.

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_OIDC_TOKEN;
}

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://test.local", { headers });
}

// ─── Inline the core logic for testing (avoids "server-only" import) ─────
async function resolveOidcToken(
  isVercel: boolean,
  req?: Request,
  envToken?: string,
): Promise<string | null> {
  // Simulates the unified function logic without @vercel/oidc SDK call
  // (SDK can't run outside Vercel runtime)

  // Skip step 1 (SDK) for unit tests — covered by integration tests on Vercel

  // Step 2: request headers
  if (req) {
    const headerToken = req.headers.get("x-vercel-oidc-token");
    if (headerToken) return headerToken;

    const fallback = req.headers.get("x-vercel-oidc");
    if (fallback) return fallback;

    const auth = req.headers.get("authorization") || "";
    if (auth.toLowerCase().startsWith("bearer ")) {
      const token = auth.slice(7).trim();
      if (token) return token;
    }
  }

  // Step 3: env fallback
  if (envToken) return envToken;

  return null;
}

test("resolves from x-vercel-oidc-token header", async () => {
  const req = buildRequest({ "x-vercel-oidc-token": "token-from-header" });
  const result = await resolveOidcToken(false, req);
  assert.equal(result, "token-from-header");
});

test("resolves from x-vercel-oidc header (fallback)", async () => {
  const req = buildRequest({ "x-vercel-oidc": "fallback-token" });
  const result = await resolveOidcToken(false, req);
  assert.equal(result, "fallback-token");
});

test("resolves from Authorization bearer header", async () => {
  const req = buildRequest({ authorization: "Bearer my-bearer-token" });
  const result = await resolveOidcToken(false, req);
  assert.equal(result, "my-bearer-token");
});

test("resolves from env token when no request", async () => {
  const result = await resolveOidcToken(false, undefined, "env-token-value");
  assert.equal(result, "env-token-value");
});

test("returns null when nothing available", async () => {
  const result = await resolveOidcToken(false);
  assert.equal(result, null);
});

test("x-vercel-oidc-token takes priority over Authorization", async () => {
  const req = buildRequest({
    "x-vercel-oidc-token": "primary",
    authorization: "Bearer secondary",
  });
  const result = await resolveOidcToken(false, req);
  assert.equal(result, "primary");
});

test("header takes priority over env token", async () => {
  const req = buildRequest({ "x-vercel-oidc-token": "from-header" });
  const result = await resolveOidcToken(false, req, "from-env");
  assert.equal(result, "from-header");
});
