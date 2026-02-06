import assert from "node:assert/strict";
import { test } from "node:test";

import { getWifProvider, hasWifProviderConfig } from "@/lib/google/wif/getWifProvider";
import { resolveProviderResource } from "@/lib/gcp/wif";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  // Clear all WIF-related vars
  delete process.env.GCP_WIF_PROVIDER;
  delete process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  delete process.env.GCP_PROJECT_NUMBER;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  delete process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
}

test("getWifProvider prefers GCP_WIF_PROVIDER (canonical)", () => {
  resetEnv();
  process.env.GCP_WIF_PROVIDER = "projects/123/locations/global/workloadIdentityPools/pool/providers/prov";
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = "should-not-use-this";

  assert.equal(getWifProvider(), "projects/123/locations/global/workloadIdentityPools/pool/providers/prov");
});

test("getWifProvider falls back to GCP_WORKLOAD_IDENTITY_PROVIDER (alias)", () => {
  resetEnv();
  process.env.GCP_WORKLOAD_IDENTITY_PROVIDER = "projects/456/locations/global/workloadIdentityPools/p2/providers/p2";

  assert.equal(getWifProvider(), "projects/456/locations/global/workloadIdentityPools/p2/providers/p2");
});

test("getWifProvider composes from split vars", () => {
  resetEnv();
  process.env.GCP_PROJECT_NUMBER = "789";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "mypool";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "myprov";

  assert.equal(
    getWifProvider(),
    "projects/789/locations/global/workloadIdentityPools/mypool/providers/myprov",
  );
});

test("getWifProvider throws when nothing configured", () => {
  resetEnv();
  assert.throws(() => getWifProvider(), /Missing Workload Identity/);
});

test("hasWifProviderConfig returns false when nothing configured", () => {
  resetEnv();
  assert.equal(hasWifProviderConfig(), false);
});

test("hasWifProviderConfig returns true with canonical var", () => {
  resetEnv();
  process.env.GCP_WIF_PROVIDER = "projects/1/locations/global/workloadIdentityPools/p/providers/p";
  assert.equal(hasWifProviderConfig(), true);
});

test("resolveProviderResource delegates to getWifProvider", () => {
  resetEnv();
  process.env.GCP_WIF_PROVIDER = "projects/123/locations/global/workloadIdentityPools/pool/providers/provider";

  const result = resolveProviderResource();
  assert.equal(
    result,
    "projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
  );
});
