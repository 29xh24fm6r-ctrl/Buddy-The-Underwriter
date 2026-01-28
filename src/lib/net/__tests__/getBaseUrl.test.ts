import test from "node:test";
import assert from "node:assert/strict";

import { getBaseUrl } from "@/lib/net/getBaseUrl";

// Save original env values
const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_URL;
}

test.afterEach(() => {
  // Restore original env after each test
  Object.assign(process.env, ORIGINAL_ENV);
  resetEnv();
});

test("getBaseUrl: returns NEXT_PUBLIC_APP_URL when set", () => {
  resetEnv();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  assert.equal(getBaseUrl(), "https://app.example.com");
});

test("getBaseUrl: strips trailing slashes from NEXT_PUBLIC_APP_URL", () => {
  resetEnv();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com///";
  assert.equal(getBaseUrl(), "https://app.example.com");
});

test("getBaseUrl: prefers NEXT_PUBLIC_APP_URL over NEXT_PUBLIC_SITE_URL", () => {
  resetEnv();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  process.env.NEXT_PUBLIC_SITE_URL = "https://site.example.com";
  assert.equal(getBaseUrl(), "https://app.example.com");
});

test("getBaseUrl: falls back to NEXT_PUBLIC_SITE_URL", () => {
  resetEnv();
  process.env.NEXT_PUBLIC_SITE_URL = "https://site.example.com/";
  assert.equal(getBaseUrl(), "https://site.example.com");
});

test("getBaseUrl: falls back to VERCEL_URL and prepends https://", () => {
  resetEnv();
  process.env.VERCEL_URL = "my-app-abc123.vercel.app";
  assert.equal(getBaseUrl(), "https://my-app-abc123.vercel.app");
});

test("getBaseUrl: VERCEL_URL with http prefix is used as-is", () => {
  resetEnv();
  process.env.VERCEL_URL = "http://localhost:3000";
  assert.equal(getBaseUrl(), "http://localhost:3000");
});

test("getBaseUrl: returns null when no env vars are set", () => {
  resetEnv();
  assert.equal(getBaseUrl(), null);
});
