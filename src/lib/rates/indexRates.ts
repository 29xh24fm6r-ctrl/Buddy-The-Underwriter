import "server-only";

import { runRole } from "@/lib/ai/gateway";

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

type CacheEntry = { expiresAt: number; value: Record<IndexCode, IndexRate> };
let cache: CacheEntry | null = null;
const TTL_MS = 15 * 60 * 1000; // 15 min cache

async function fetchRatesViaGemini(): Promise<Record<IndexCode, IndexRate>> {
  const today = new Date().toISOString().split("T")[0];

  // SPEC-M1.1: routed through the AI gateway (runRole, "generator" role,
  // useSearchGrounding — Gemini's google_search tool, needed to look up
  // live rate benchmarks rather than rely on training data).
  const result = await runRole("generator", {
    purpose: "index_rates_lookup",
    prompt: `Today is ${today}. Please look up the current values for these three US interest rate benchmarks and return ONLY a JSON object, no markdown, no explanation:
{
  "SOFR": { "rate": <number>, "asOf": "<YYYY-MM-DD>" },
  "UST_5Y": { "rate": <number>, "asOf": "<YYYY-MM-DD>" },
  "PRIME": { "rate": <number>, "asOf": "<YYYY-MM-DD>" }
}
SOFR = Secured Overnight Financing Rate (NY Fed)
UST_5Y = 5-Year US Treasury yield (daily, from Treasury.gov)
PRIME = Bank Prime Loan Rate (from Federal Reserve / FRED DPRIME)
All rates should be in percent (e.g. 5.33 not 0.0533).`,
    temperature: 0,
    useSearchGrounding: true,
    timeoutMs: 20_000,
  });

  const clean = result.text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  const now = new Date().toISOString().split("T")[0];

  return {
    SOFR: {
      code: "SOFR",
      label: "SOFR (NY Fed)",
      ratePct: Number(parsed.SOFR.rate),
      asOf: parsed.SOFR.asOf ?? now,
      source: "nyfed",
    },
    UST_5Y: {
      code: "UST_5Y",
      label: "5Y Treasury",
      ratePct: Number(parsed.UST_5Y.rate),
      asOf: parsed.UST_5Y.asOf ?? now,
      source: "treasury",
    },
    PRIME: {
      code: "PRIME",
      label: "Prime Rate",
      ratePct: Number(parsed.PRIME.rate),
      asOf: parsed.PRIME.asOf ?? now,
      source: "fred",
    },
  };
}

export async function getLatestIndexRates(): Promise<Record<IndexCode, IndexRate>> {
  const t = Date.now();
  if (cache && cache.expiresAt > t) return cache.value;

  const value = await fetchRatesViaGemini();
  cache = { expiresAt: t + TTL_MS, value };
  return value;
}

/** Test-only: clears the in-process rate cache between test cases. */
export function __resetIndexRatesCacheForTests(): void {
  cache = null;
}
