import "server-only";

export type IndexCode = "UST_5Y" | "SOFR" | "PRIME";

export type IndexRate = {
  code: IndexCode;
  label: string;
  ratePct: number;
  asOf: string; // date or ISO
  source: "treasury" | "nyfed" | "fed_h15" | "fred";
  sourceUrl?: string;
  raw?: unknown;
};

type CacheEntry = { expiresAt: number; value: Record<IndexCode, IndexRate> };
let cache: CacheEntry | null = null;
const TTL_MS = 15 * 60 * 1000;

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  return res.text();
}

async function getSOFR(): Promise<IndexRate> {
  const url = "https://markets.newyorkfed.org/api/rates/secured/sofr.json";
  const data = await fetchJson(url);

  const series = data?.refRates?.[0];
  const obs = series?.observations;
  const last = Array.isArray(obs) && obs.length ? obs[obs.length - 1] : null;
  const rate = Number(last?.value);

  if (!Number.isFinite(rate)) throw new Error("SOFR parse failed");

  return {
    code: "SOFR",
    label: "SOFR (NY Fed)",
    ratePct: rate,
    asOf: last?.effectiveDate ?? last?.date ?? new Date().toISOString(),
    source: "nyfed",
    sourceUrl: url,
    raw: { last },
  };
}

async function getUST5Y(): Promise<IndexRate> {
  const url =
    "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/daily_treasury_yield_curve_rates" +
    "?page[size]=1&sort=-record_date&fields=record_date,bc_5year";
  const data = await fetchJson(url);
  const row = data?.data?.[0];
  const rate = Number(row?.bc_5year);

  if (!Number.isFinite(rate)) throw new Error("UST 5Y parse failed");

  return {
    code: "UST_5Y",
    label: "5Y Treasury (Daily)",
    ratePct: rate,
    asOf: row?.record_date ?? new Date().toISOString(),
    source: "treasury",
    sourceUrl: url,
    raw: { row },
  };
}

async function getPrime(): Promise<IndexRate> {
  const url = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DPRIME";
  const csv = await fetchText(url);

  const lines = csv.trim().split("\n");
  for (let i = lines.length - 1; i >= 1; i--) {
    const [date, value] = lines[i].split(",");
    const rate = Number(value);
    if (date && Number.isFinite(rate)) {
      return {
        code: "PRIME",
        label: "Prime (Bank Prime Loan Rate)",
        ratePct: rate,
        asOf: date,
        source: "fred",
        sourceUrl: url,
        raw: { date, value },
      };
    }
  }
  throw new Error("Prime parse failed");
}

export async function getLatestIndexRates(): Promise<Record<IndexCode, IndexRate>> {
  const t = Date.now();
  if (cache && cache.expiresAt > t) return cache.value;

  const [ust5y, sofr, prime] = await Promise.all([getUST5Y(), getSOFR(), getPrime()]);
  const value: Record<IndexCode, IndexRate> = {
    UST_5Y: ust5y,
    SOFR: sofr,
    PRIME: prime,
  };

  cache = { expiresAt: t + TTL_MS, value };
  return value;
}
