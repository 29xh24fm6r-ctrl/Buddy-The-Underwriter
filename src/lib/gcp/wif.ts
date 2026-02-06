import { getWifProvider } from "@/lib/google/wif/getWifProvider";

/**
 * Resolves the WIF provider resource path.
 * Delegates to the canonical resolver in `@/lib/google/wif/getWifProvider`.
 */
export function resolveProviderResource(): string {
  return getWifProvider();
}

export function resolveAudience(): string {
  const providerResource = resolveProviderResource();
  return providerResource.startsWith("//iam.googleapis.com/")
    ? providerResource
    : `//iam.googleapis.com/${providerResource}`;
}

export function resolveServiceAccountEmail(): string {
  const email = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error(
      "Missing GCP_SERVICE_ACCOUNT_EMAIL. Set GCP_SERVICE_ACCOUNT_EMAIL and either GCP_WIF_PROVIDER or (GCP_PROJECT_NUMBER + GCP_WORKLOAD_IDENTITY_POOL_ID + GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID).",
    );
  }
  return email;
}
