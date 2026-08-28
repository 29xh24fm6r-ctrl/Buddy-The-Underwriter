import "server-only";

import type { IndexRate } from "./indexRates";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RATE_AGE_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1_000;
const MAX_RATE_PCT = 30;

const NY_FED_SOFR_URL =
  "https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json";
const TREASURY_YIELD_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
const FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv";

type FetchLike = typeof fetch;

function normalizeDate(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("benchmark rate date is missing");
  }
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error("benchmark rate date is invalid");
  return match[0];
}

function validateRate(ratePct: unknown, asOfValue: unknown): {
  ratePct: number;
  asOf: string;
} {
  const numeric = Number(ratePct);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_RATE_PCT) {
    throw new Error("benchmark rate is outside the accepted range");
  }

  const asOf = normalizeDate(asOfValue);
  const timestamp = Date.parse(asOf + "T00:00:00.000Z");
  const age = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || age > MAX_RATE_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
    throw new Error("benchmark rate date is outside the accepted window");
  }

  return { ratePct: numeric, asOf };
}

async function fetchText(
  url: string,
  label: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json, text/csv, application/xml, text/xml" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(label + " returned HTTP " + response.status);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function makeRate(
  input: Omit<IndexRate, "ratePct" | "asOf"> & {
    ratePct: unknown;
    asOf: unknown;
  },
): IndexRate {
  const validated = validateRate(input.ratePct, input.asOf);
  return { ...input, ...validated };
}

export async function fetchNyFedSofr(
  fetchImpl: FetchLike = fetch,
): Promise<IndexRate> {
  const text = await fetchText(NY_FED_SOFR_URL, "NY Fed SOFR", fetchImpl);
  const payload = JSON.parse(text) as {
    refRates?: Array<{ effectiveDate?: unknown; percentRate?: unknown }>;
  };
  const row = payload.refRates?.[0];
  if (!row) throw new Error("NY Fed SOFR response contains no observations");

  return makeRate({
    code: "SOFR",
    label: "SOFR (NY Fed)",
    ratePct: row.percentRate,
    asOf: row.effectiveDate,
    source: "nyfed",
    sourceUrl: NY_FED_SOFR_URL,
  });
}

function xmlField(entry: string, field: string): string | undefined {
  const pattern = new RegExp(
    "<(?:[A-Za-z0-9_-]+:)?" + field + "\\b[^>]*>([^<]+)</(?:[A-Za-z0-9_-]+:)?" + field + ">",
    "i",
  );
  return pattern.exec(entry)?.[1]?.trim();
}

export async function fetchTreasuryFiveYear(
  fetchImpl: FetchLike = fetch,
): Promise<IndexRate> {
  const now = new Date();
  const month =
    String(now.getUTCFullYear()) + String(now.getUTCMonth() + 1).padStart(2, "0");
  const url =
    TREASURY_YIELD_URL +
    "?data=daily_treasury_yield_curve&field_tdr_date_value_month=" +
    month;
  const xml = await fetchText(url, "Treasury yield curve", fetchImpl);
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const observations = entries
    .map((entry) => ({
      asOf: xmlField(entry, "NEW_DATE"),
      ratePct: xmlField(entry, "BC_5YEAR"),
    }))
    .filter((row) => row.asOf && row.ratePct)
    .sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)));
  const row = observations[0];
  if (!row) throw new Error("Treasury response contains no five-year observations");

  return makeRate({
    code: "UST_5Y",
    label: "5Y Treasury",
    ratePct: row.ratePct,
    asOf: row.asOf,
    source: "treasury",
    sourceUrl: url,
  });
}

function fredStartDate(): string {
  return new Date(Date.now() - MAX_RATE_AGE_MS).toISOString().slice(0, 10);
}

export async function fetchFredSeries(
  series: "SOFR" | "DGS5" | "DPRIME",
  code: IndexRate["code"],
  label: string,
  fetchImpl: FetchLike = fetch,
): Promise<IndexRate> {
  const url =
    FRED_CSV_URL +
    "?id=" +
    encodeURIComponent(series) +
    "&cosd=" +
    fredStartDate();
  const csv = await fetchText(url, "FRED " + series, fetchImpl);
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .filter(
      (columns): columns is [string, string] =>
        columns.length >= 2 && Boolean(columns[0]) && columns[1] !== ".",
    );
  const row = rows.at(-1);
  if (!row) throw new Error("FRED " + series + " response contains no observations");

  return makeRate({
    code,
    label,
    ratePct: row[1],
    asOf: row[0],
    source: "fred",
    sourceUrl: url,
  });
}
