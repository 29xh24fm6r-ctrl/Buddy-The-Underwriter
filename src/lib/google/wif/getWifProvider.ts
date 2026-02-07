/**
 * Canonical Workload Identity Federation (WIF) provider resolver.
 *
 * All GCP auth paths (GCS, DocAI, Vertex, manual STS) MUST use this function
 * so they share the same config contract and never diverge.
 *
 * Env var priority:
 *   1. GCP_WIF_PROVIDER          — canonical (full resource path)
 *   2. GCP_WORKLOAD_IDENTITY_PROVIDER — alias (backwards-compatible)
 *   3. GCP_PROJECT_NUMBER + GCP_WORKLOAD_IDENTITY_POOL_ID +
 *      GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID — composed from split vars
 */

function buildMissingMessage(): string {
  return [
    "Missing Workload Identity provider configuration.",
    "Set GCP_WIF_PROVIDER (canonical)",
    "or GCP_WORKLOAD_IDENTITY_PROVIDER (alias)",
    "or GCP_PROJECT_NUMBER + GCP_WORKLOAD_IDENTITY_POOL_ID + GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID.",
  ].join(" ");
}

/**
 * Returns the WIF provider resource path, e.g.
 * `projects/123/locations/global/workloadIdentityPools/pool/providers/prov`.
 *
 * Throws if no configuration is available.
 */
export function getWifProvider(): string {
  // 1. Canonical
  const canonical = process.env.GCP_WIF_PROVIDER;
  if (canonical) return canonical;

  // 2. Alias (backwards-compatible)
  const alias = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
  if (alias) return alias;

  // 3. Compose from split vars
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  if (projectNumber && poolId && providerId) {
    return `projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
  }

  throw new Error(buildMissingMessage());
}

/**
 * Returns true if any WIF provider configuration is present.
 * Useful for config gates (e.g. deciding GCS vs Supabase) without throwing.
 */
export function hasWifProviderConfig(): boolean {
  try {
    getWifProvider();
    return true;
  } catch {
    return false;
  }
}

const IAM_PREFIX = "//iam.googleapis.com/";

/**
 * Normalizes a WIF provider string to the full audience form required by Google STS:
 *   `//iam.googleapis.com/projects/.../workloadIdentityPools/.../providers/...`
 *
 * Accepts both short (`projects/...`) and full (`//iam.googleapis.com/projects/...`) forms.
 * Throws on invalid input.
 */
export function normalizeWifProvider(provider: string): string {
  if (!provider) {
    throw new Error("Invalid WIF provider format: empty string");
  }

  if (provider.startsWith(IAM_PREFIX)) {
    return provider;
  }

  if (provider.startsWith("projects/")) {
    return `${IAM_PREFIX}${provider}`;
  }

  throw new Error(
    `Invalid WIF provider format: expected "projects/..." or "//iam.googleapis.com/projects/...", got "${provider.slice(0, 60)}"`,
  );
}
