/**
 * SPEC-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-AND-ADS-MATERIALIZATION-1
 *
 * Pure-core regressions for computeTotalDebtService:
 *   - ADS facts are stamped with a VALID period date, never the 1900-01-01 sentinel.
 *   - Omnicare-shaped structural pricing (101,250, no existing debt) materializes
 *     ANNUAL_DEBT_SERVICE_PROPOSED = 101,250 and ANNUAL_DEBT_SERVICE = 101,250.
 *   - A skipped/failed REQUIRED write surfaces loudly (ok:false).
 *   - A stale 75,000 proposed cannot remain active alongside a fresh 101,250.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  resolveAdsPeriodDate,
  computeAdsTotals,
  summarizeAdsWriteResults,
  staleAdsFactsToSupersede,
  MIN_VALID_PERIOD_DATE,
} from "@/lib/structuralPricing/computeTotalDebtServiceCore";

const SENTINEL_DATE = "1900-01-01";

const TODAY = "2026-06-26";

// ── resolveAdsPeriodDate: never the sentinel / never invalid ─────────────────

test("[ads-1] sentinel computed_at → today (never 1900-01-01)", () => {
  const d = resolveAdsPeriodDate(SENTINEL_DATE, TODAY);
  assert.equal(d, TODAY);
  assert.ok(d > MIN_VALID_PERIOD_DATE);
  assert.notEqual(d, SENTINEL_DATE);
});

test("[ads-1b] null/undefined computed_at → today", () => {
  assert.equal(resolveAdsPeriodDate(null, TODAY), TODAY);
  assert.equal(resolveAdsPeriodDate(undefined, TODAY), TODAY);
});

test("[ads-1c] valid computed_at timestamp → its date prefix", () => {
  assert.equal(resolveAdsPeriodDate("2026-05-01T12:34:56.000Z", TODAY), "2026-05-01");
});

test("[ads-1d] resolved period is ALWAYS > MIN_VALID_PERIOD_DATE for any input", () => {
  for (const input of [SENTINEL_DATE, "1899-01-01", "1989-12-31", null, "", "garbage"]) {
    const d = resolveAdsPeriodDate(input as any, TODAY);
    assert.ok(d > MIN_VALID_PERIOD_DATE, `resolved ${d} for input ${input}`);
  }
});

// ── computeAdsTotals: Omnicare-shaped + existing-debt handling ────────────────

test("[ads-2] Omnicare: proposed 101,250 + NO existing debt rows → total 101,250", () => {
  const t = computeAdsTotals({ proposed: 101_250, existingRows: [], skipExistingDebt: false });
  assert.equal(t.proposed, 101_250);
  assert.equal(t.existing, null);
  assert.equal(t.total, 101_250);
  assert.equal(t.existingDebtRowsPresent, false);
});

test("[ads-2b] proposed + existing rows → summed total", () => {
  const t = computeAdsTotals({
    proposed: 101_250,
    existingRows: [
      { annual_debt_service: 24_000, monthly_payment: null },
      { annual_debt_service: null, monthly_payment: 1_000 },
    ],
    skipExistingDebt: false,
  });
  assert.equal(t.existing, 24_000 + 12_000);
  assert.equal(t.total, 101_250 + 36_000);
  assert.equal(t.existingDebtRowsPresent, true);
});

test("[ads-2c] skipExistingDebt → existing treated as 0", () => {
  const t = computeAdsTotals({ proposed: 101_250, existingRows: null, skipExistingDebt: true });
  assert.equal(t.existing, 0);
  assert.equal(t.total, 101_250);
});

test("[ads-2d] existing rows all-null payments → existing null (not 0)", () => {
  const t = computeAdsTotals({
    proposed: null,
    existingRows: [{ annual_debt_service: null, monthly_payment: null }],
    skipExistingDebt: false,
  });
  assert.equal(t.existing, null);
  assert.equal(t.total, null);
});

// ── summarizeAdsWriteResults: skipped/failed required writes are loud ─────────

test("[ads-3] required write skipped (invalid_period_date) → ok:false with diagnostic", () => {
  const r = summarizeAdsWriteResults([
    { key: "ANNUAL_DEBT_SERVICE", ok: false, error: "invalid_period_date", skipped: true, required: true },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.diagnostics[0], /ANNUAL_DEBT_SERVICE write skipped: invalid_period_date/);
});

test("[ads-3b] all required writes ok → ok:true even if an optional one fails", () => {
  const r = summarizeAdsWriteResults([
    { key: "ANNUAL_DEBT_SERVICE_PROPOSED", ok: true, required: true },
    { key: "ANNUAL_DEBT_SERVICE", ok: true, required: true },
    { key: "DSCR", ok: false, error: "x", required: false },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.diagnostics.length, 0);
});

// ── staleAdsFactsToSupersede: stale 75k cannot remain active vs fresh 101,250 ─

test("[ads-4] stale 75k proposed (different period) is superseded; fresh 101,250 is not", () => {
  const existing = [
    { id: "stale-proposed", fact_key: "ANNUAL_DEBT_SERVICE_PROPOSED", owner_type: "DEAL", fact_period_end: SENTINEL_DATE, is_superseded: false },
    { id: "fresh-proposed", fact_key: "ANNUAL_DEBT_SERVICE_PROPOSED", owner_type: "DEAL", fact_period_end: TODAY, is_superseded: false },
    { id: "fresh-total", fact_key: "ANNUAL_DEBT_SERVICE", owner_type: "DEAL", fact_period_end: TODAY, is_superseded: false },
  ];
  const ids = staleAdsFactsToSupersede({
    existing,
    writtenKeys: ["ANNUAL_DEBT_SERVICE_PROPOSED", "ANNUAL_DEBT_SERVICE"],
    freshPeriodEnd: TODAY,
  });
  assert.deepEqual(ids, ["stale-proposed"]);
});

test("[ads-4b] non-DEAL owner and unrelated keys are never superseded", () => {
  const existing = [
    { id: "personal", fact_key: "ANNUAL_DEBT_SERVICE_PROPOSED", owner_type: "PERSONAL", fact_period_end: "2024-01-01", is_superseded: false },
    { id: "cfa", fact_key: "CASH_FLOW_AVAILABLE", owner_type: "DEAL", fact_period_end: SENTINEL_DATE, is_superseded: false },
  ];
  const ids = staleAdsFactsToSupersede({
    existing,
    writtenKeys: ["ANNUAL_DEBT_SERVICE_PROPOSED", "ANNUAL_DEBT_SERVICE"],
    freshPeriodEnd: TODAY,
  });
  assert.deepEqual(ids, []);
});

// ── Source-text guards: the server fn actually wires the core correctly ───────

const TDS = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/structuralPricing/computeTotalDebtService.ts"),
  "utf8",
);

test("[ads-5] computeTotalDebtService stamps factPeriodStart/End on ADS writes", () => {
  assert.match(TDS, /factPeriodStart:\s*periodDate/);
  assert.match(TDS, /factPeriodEnd:\s*periodDate/);
});

test("[ads-5b] computeTotalDebtService resolves the period via resolveAdsPeriodDate", () => {
  assert.match(TDS, /resolveAdsPeriodDate\(/);
  // It must select computed_at from structural pricing for the period basis.
  assert.match(TDS, /computed_at/);
});

test("[ads-5c] computeTotalDebtService inspects write results and returns ok:false loudly", () => {
  assert.match(TDS, /summarizeAdsWriteResults/);
  assert.match(TDS, /ads_write_failed/);
});

test("[ads-5d] computeTotalDebtService supersedes stale ADS facts", () => {
  assert.match(TDS, /staleAdsFactsToSupersede/);
  assert.match(TDS, /is_superseded:\s*true/);
});
