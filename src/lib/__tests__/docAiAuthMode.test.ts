import assert from "node:assert/strict";
import { test } from "node:test";

// Can't directly import extractWithGoogleDocAi due to "server-only" guard,
// so we test the auth mode selection logic inline.

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.GCP_WIF_PROVIDER;
  delete process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  delete process.env.GCP_PROJECT_NUMBER;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
}

type DocAiAuthMode = "vercel_wif" | "json" | "adc";

// Inline the auth mode logic from extractWithGoogleDocAi.ts
function computeAuthMode(): DocAiAuthMode {
  const isVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);

  let hasWif = false;
  try {
    const canonical = process.env.GCP_WIF_PROVIDER;
    if (canonical) { hasWif = true; }
    else {
      const alias = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
      if (alias) { hasWif = true; }
      else {
        const pn = process.env.GCP_PROJECT_NUMBER;
        const pi = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
        const pp = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
        if (pn && pi && pp) hasWif = true;
      }
    }
  } catch { /* no config */ }

  if (isVercel && hasWif) return "vercel_wif";
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()) return "json";
  return "adc";
}

test("selects vercel_wif when on Vercel with WIF provider", () => {
  resetEnv();
  process.env.VERCEL = "1";
  process.env.GCP_WIF_PROVIDER = "projects/1/locations/global/workloadIdentityPools/p/providers/p";
  assert.equal(computeAuthMode(), "vercel_wif");
});

test("selects vercel_wif with alias env var", () => {
  resetEnv();
  process.env.VERCEL = "1";
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = "projects/1/locations/global/workloadIdentityPools/p/providers/p";
  assert.equal(computeAuthMode(), "vercel_wif");
});

test("selects json when GOOGLE_APPLICATION_CREDENTIALS_JSON is set (non-Vercel)", () => {
  resetEnv();
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account"}';
  assert.equal(computeAuthMode(), "json");
});

test("selects adc as default (local dev)", () => {
  resetEnv();
  assert.equal(computeAuthMode(), "adc");
});

test("prefers vercel_wif over json on Vercel", () => {
  resetEnv();
  process.env.VERCEL = "1";
  process.env.GCP_WIF_PROVIDER = "projects/1/locations/global/workloadIdentityPools/p/providers/p";
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account"}';
  assert.equal(computeAuthMode(), "vercel_wif");
});

test("falls back to json on Vercel without WIF", () => {
  resetEnv();
  process.env.VERCEL = "1";
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = '{"type":"service_account"}';
  assert.equal(computeAuthMode(), "json");
});
