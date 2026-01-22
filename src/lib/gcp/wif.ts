function buildMissingProviderMessage(): string {
  return [
    "Missing Workload Identity provider configuration.",
    "Set GCP_WIF_PROVIDER or set GCP_PROJECT_NUMBER + GCP_WORKLOAD_IDENTITY_POOL_ID + GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID.",
  ].join(" ");
}

export function resolveProviderResource(): string {
  const provider = process.env.GCP_WIF_PROVIDER;
  if (provider) return provider;

  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  if (projectNumber && poolId && providerId) {
    return `projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
  }

  throw new Error(buildMissingProviderMessage());
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
