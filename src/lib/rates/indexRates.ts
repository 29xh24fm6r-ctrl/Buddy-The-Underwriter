import "server-only";

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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const today = new Date().toISOString().split("T")[0];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Today is ${today}. Please look up the current values for these three US interest rate benchmarks and return ONLY a JSON object, no markdown, no explanation:
{
  "SOFR": { "rate": <number>, "asOf": "<YYYY-MM-DD>" },
  "UST_5Y": { "rate": <number>, "asOf": "<YYYY-MM-DD>" },
  "PRIME": { "rate": <number>, "asOf": "<YYYY-MM-DD>" }
}
SOFR = Secured Overnight Financing Rate (NY Fed)
UST_5Y = 5-Year US Treasury yield (daily, from Treasury.gov)
PRIME = Bank Prime Loan Rate (from Federal Reserve / FRED DPRIME)
All rates should be in percent (e.g. 5.33 not 0.0533).`
          }]
        }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(20000),
    }
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const clean = text.replace(/```json|```/g, "").trim();
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
