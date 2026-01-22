import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveProviderResource } from "@/lib/gcp/wif";

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

test("resolveProviderResource uses GCP_WIF_PROVIDER when set", () => {
  resetEnv();
  process.env.GCP_WIF_PROVIDER = "projects/123/locations/global/workloadIdentityPools/pool/providers/provider";
  process.env.GCP_PROJECT_NUMBER = "";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "";

  const result = resolveProviderResource();
  assert.equal(
    result,
    "projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
  );
});

test("resolveProviderResource builds provider resource from split envs", () => {
  resetEnv();
  process.env.GCP_WIF_PROVIDER = "";
  process.env.GCP_PROJECT_NUMBER = "123";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "pool";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "provider";

  const result = resolveProviderResource();
  assert.equal(
    result,
    "projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
  );
});
