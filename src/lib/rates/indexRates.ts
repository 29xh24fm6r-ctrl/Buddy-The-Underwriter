import "server-only";

import {
  fetchFredSeries,
  fetchNyFedSofr,
  fetchTreasuryFiveYear,
} from "./officialRateSources";

export type IndexCode = "UST_5Y" | "SOFR" | "PRIME";

export type IndexRate = {
  code: IndexCode;
  label: string;
  ratePct: number;
  asOf: string;
  source: "treasury" | "nyfed" | "fed_h15" | "fred";
  sourceUrl?: string;
  raw?: unknown;
};

type RateSet = Record<IndexCode, IndexRate>;
type CacheEntry = {
  expiresAt: number;
  staleUntil: number;
  value: RateSet;
};

let cache: CacheEntry | null = null;
const TTL_MS = 15 * 60 * 1_000;
const STALE_IF_ERROR_MS = 7 * 24 * 60 * 60 * 1_000;

export class RateFeedUnavailableError extends Error {
  constructor() {
    super("benchmark rate feed is temporarily unavailable");
    this.name = "RateFeedUnavailableError";
  }
}

async function withFallback(
  primary: () => Promise<IndexRate>,
  fallback: () => Promise<IndexRate>,
): Promise<IndexRate> {
  try {
    return await primary();
  } catch {
    return await fallback();
  }
}

async function fetchOfficialRates(): Promise<RateSet> {
  const [sofr, treasury, prime] = await Promise.all([
    withFallback(
      () => fetchNyFedSofr(),
      () => fetchFredSeries("SOFR", "SOFR", "SOFR (NY Fed)"),
    ),
    withFallback(
      () => fetchTreasuryFiveYear(),
      () => fetchFredSeries("DGS5", "UST_5Y", "5Y Treasury"),
    ),
    fetchFredSeries("DPRIME", "PRIME", "Prime Rate"),
  ]);

  return { SOFR: sofr, UST_5Y: treasury, PRIME: prime };
}

function staleCopy(value: RateSet): RateSet {
  return Object.fromEntries(
    Object.entries(value).map(([code, rate]) => [
      code,
      {
        ...rate,
        raw: {
          stale: true,
          reason: "official_refresh_failed",
          lastKnownSource: rate.source,
        },
      },
    ]),
  ) as RateSet;
}

export async function getLatestIndexRates(): Promise<RateSet> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  try {
    const value = await fetchOfficialRates();
    cache = {
      expiresAt: now + TTL_MS,
      staleUntil: now + STALE_IF_ERROR_MS,
      value,
    };
    return value;
  } catch (error) {
    if (cache && cache.staleUntil > now) {
      console.warn("[rates] official refresh failed; serving last-known-good rates", {
        error: error instanceof Error ? error.message : "unknown error",
      });
      return staleCopy(cache.value);
    }
    throw new RateFeedUnavailableError();
  }
}

/** Test-only: clears the in-process rate cache between test cases. */
export function __resetIndexRatesCacheForTests(): void {
  cache = null;
}
