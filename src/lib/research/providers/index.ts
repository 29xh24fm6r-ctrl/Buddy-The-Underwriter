/**
 * Provider Abstraction Layer — Phase 66A (Commit 5)
 *
 * Wraps external data sources behind a uniform interface.
 * OpenBB-inspired: no direct API calls in research threads.
 *
 * Providers:
 * - Government data (Census, BLS, BEA)
 * - Regulatory data (SEC EDGAR, SBA)
 * - Industry data (trade associations)
 * - Geographic data (Census ACS)
 * - News/media
 *
 * All providers implement the same interface so the research
 * pipeline doesn't care where data comes from.
 */

// ============================================================================
// Types
// ============================================================================

export type ProviderCategory =
  | "government"
  | "regulatory"
  | "industry"
  | "company"
  | "geography"
  | "news";

export type ProviderStatus = "available" | "degraded" | "unavailable";

export type ProviderResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
  provider: string;
  category: ProviderCategory;
  /** Time to fetch in ms */
  latencyMs: number;
  /** Whether this was served from cache */
  cached: boolean;
  /** Trust score 0-1 for this provider */
  trustScore: number;
};

export type ProviderConfig = {
  name: string;
  category: ProviderCategory;
  baseUrl: string;
  trustScore: number;
  /** Rate limit: requests per minute */
  rateLimit: number;
  /** Default timeout in ms */
  timeoutMs: number;
  /** Whether the provider requires authentication */
  requiresAuth: boolean;
};

// ============================================================================
// Provider Interface
// ============================================================================

export interface DataProvider<TQuery = Record<string, unknown>, TResult = unknown> {
  readonly name: string;
  readonly category: ProviderCategory;
  readonly trustScore: number;

  /** Check if provider is available */
  checkHealth(): Promise<ProviderStatus>;

  /** Fetch data from this provider */
  fetch(query: TQuery): Promise<ProviderResponse<TResult>>;
}

// ============================================================================
// Provider Registry
// ============================================================================

const providers = new Map<string, DataProvider>();

/**
 * Register a data provider.
 */
export function registerProvider(provider: DataProvider): void {
  providers.set(provider.name, provider);
}

/**
 * Get a provider by name.
 */
export function getProvider(name: string): DataProvider | undefined {
  return providers.get(name);
}

/**
 * Get all providers for a category.
 */
export function getProvidersByCategory(category: ProviderCategory): DataProvider[] {
  return Array.from(providers.values()).filter((p) => p.category === category);
}

/**
 * Get all registered providers.
 */
export function getAllProviders(): DataProvider[] {
  return Array.from(providers.values());
}

/**
 * Check health of all providers.
 */
export async function checkAllProviderHealth(): Promise<
  { name: string; category: ProviderCategory; status: ProviderStatus }[]
> {
  const results = await Promise.allSettled(
    Array.from(providers.values()).map(async (p) => ({
      name: p.name,
      category: p.category,
      status: await p.checkHealth(),
    })),
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { name: "unknown", category: "government" as ProviderCategory, status: "unavailable" as ProviderStatus },
  );
}

// ============================================================================
// Built-in Provider Configs
// ============================================================================

export const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    name: "census_acs",
    category: "geography",
    baseUrl: "https://api.census.gov/data",
    trustScore: 0.95,
    rateLimit: 50,
    timeoutMs: 30_000,
    requiresAuth: false,
  },
  {
    name: "bls_statistics",
    category: "government",
    baseUrl: "https://api.bls.gov/publicAPI/v2",
    trustScore: 0.95,
    rateLimit: 25,
    timeoutMs: 30_000,
    requiresAuth: false,
  },
  {
    name: "sec_edgar",
    category: "regulatory",
    baseUrl: "https://efts.sec.gov/LATEST",
    trustScore: 0.95,
    rateLimit: 10,
    timeoutMs: 30_000,
    requiresAuth: false,
  },
  {
    name: "bea_data",
    category: "government",
    baseUrl: "https://apps.bea.gov/api",
    trustScore: 0.95,
    rateLimit: 100,
    timeoutMs: 30_000,
    requiresAuth: true,
  },
  {
    name: "fred_data",
    category: "government",
    baseUrl: "https://api.stlouisfed.org/fred",
    trustScore: 0.90,
    rateLimit: 120,
    timeoutMs: 15_000,
    requiresAuth: true,
  },
];
