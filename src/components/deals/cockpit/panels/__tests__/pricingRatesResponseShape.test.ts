/**
 * BUGFIX-PRICING-RATES-RESPONSE-SHAPE-1 CI Guards
 *
 * Locks the contract between PricingAssumptionsCard.fetchLiveRates()
 * and the /api/rates/latest response shape:
 *   { ok: true, rates: { PRIME: { ratePct, asOf }, ... } }
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

const PRICING_CARD = "src/components/deals/cockpit/panels/PricingAssumptionsCard.tsx";

// ── Guard 1: fetchLiveRates reads json.rates (not json.SOFR etc.) ───────────

test("Guard 1: fetchLiveRates reads json.rates, not top-level json.SOFR", () => {
  const src = read(PRICING_CARD);
  // Must reference json.rates (the correct nested shape)
  assert.match(
    src,
    /json\.rates/,
    "fetchLiveRates must read from json.rates — the API nests rates under .rates",
  );
  // Must NOT read the old wrong shape (json.SOFR.rate, json.UST_5Y.rate, etc.)
  assert.doesNotMatch(
    src,
    /json\.SOFR\.rate/,
    "must not read json.SOFR.rate — old incorrect shape",
  );
  assert.doesNotMatch(
    src,
    /json\.UST_5Y\.rate/,
    "must not read json.UST_5Y.rate — old incorrect shape",
  );
  assert.doesNotMatch(
    src,
    /json\.PRIME\.rate/,
    "must not read json.PRIME.rate — old incorrect shape",
  );
});

// ── Guard 2: uses ratePct / asOf (not rate / date) ──────────────────────────

test("Guard 2: maps ratePct and asOf fields from API entries", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /entry\.ratePct/,
    "must read .ratePct from each rate entry",
  );
  assert.match(
    src,
    /entry\.asOf/,
    "must read .asOf from each rate entry",
  );
});

// ── Guard 3: Number.isFinite validation before accepting a rate ─────────────

test("Guard 3: validates Number.isFinite before accepting a rate value", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /Number\.isFinite/,
    "must validate rate with Number.isFinite before setting",
  );
});

// ── Guard 4: shows fallback message when API returns ok:false or malformed ──

test("Guard 4: shows visible status when live rates are unavailable", () => {
  const src = read(PRICING_CARD);
  assert.match(
    src,
    /Live rates unavailable/,
    "must show fallback message when rates fetch fails or returns ok:false",
  );
});

// ── Guard 5: response contract simulation ───────────────────────────────────
// Simulates the fetchLiveRates parsing logic with a mock response to verify
// that PRIME.ratePct = 7.5 hydrates correctly.

test("Guard 5: mock response { ok:true, rates:{ PRIME:{ ratePct:7.5, asOf:'2026-05-27' }}} hydrates correctly", () => {
  // Simulate the parsing logic from fetchLiveRates
  type IndexCode = "SOFR" | "UST_5Y" | "PRIME";
  type LiveRateEntry = { ratePct: number; asOf: string };
  type LiveRates = Partial<Record<IndexCode, LiveRateEntry>>;

  const json = {
    ok: true,
    rates: { PRIME: { ratePct: 7.5, asOf: "2026-05-27", code: "PRIME", label: "Prime Rate", source: "fed_h15" } },
  };

  // Replicate the parsing logic
  const ratesMap = json.rates as Record<string, { ratePct?: unknown; asOf?: unknown }>;
  const rates: LiveRates = {};
  for (const code of ["SOFR", "UST_5Y", "PRIME"] as IndexCode[]) {
    const entry = ratesMap[code];
    if (entry && Number.isFinite(Number(entry.ratePct))) {
      rates[code] = { ratePct: Number(entry.ratePct), asOf: String(entry.asOf ?? "") };
    }
  }

  // PRIME selected → index_rate_pct = 7.5
  assert.ok(rates.PRIME, "PRIME must be parsed from response");
  assert.equal(rates.PRIME.ratePct, 7.5, "PRIME ratePct must be 7.5");
  assert.equal(rates.PRIME.asOf, "2026-05-27", "PRIME asOf must be 2026-05-27");

  // SOFR and UST_5Y not in response → must not be present
  assert.equal(rates.SOFR, undefined, "SOFR must be undefined when not in response");
  assert.equal(rates.UST_5Y, undefined, "UST_5Y must be undefined when not in response");

  // Preview final rate = 7.50% when spread is blank/0
  const indexRate = rates.PRIME.ratePct;
  const spreadPct = 0; // blank/0 spread
  const floor = 0;
  const finalRate = Math.max(floor, indexRate + spreadPct);
  assert.equal(finalRate, 7.5, "final rate must be 7.50% with no spread");
});
