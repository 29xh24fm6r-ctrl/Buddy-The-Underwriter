import test from "node:test";
import assert from "node:assert/strict";

import { buildRentRollColumnsV2, rentRollTemplate } from "@/lib/financialSpreads/templates/rentRoll";
import type { RentRollRow } from "@/lib/financialSpreads/types";

test("Rent roll column registry is deterministic", () => {
  const cols = buildRentRollColumnsV2();
  assert.deepEqual(
    cols.map((c) => c.key),
    [
      "UNIT",
      "TENANT",
      "STATUS",
      "SQFT",
      "RENT_MO",
      "RENT_YR",
      "MARKET_RENT_MO",
      "LEASE_START",
      "LEASE_END",
      "WALT_YEARS",
      "NOTES",
    ],
  );
});

test("Rent roll rows sort deterministically by unit_id then tenant_name (nulls last)", () => {
  const tpl = rentRollTemplate();

  const rows: RentRollRow[] = [
    {
      id: "3",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "A-2",
      unit_type: null,
      sqft: 900,
      tenant_name: null,
      lease_start: null,
      lease_end: null,
      monthly_rent: null,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "VACANT",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
    {
      id: "1",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "A-1",
      unit_type: null,
      sqft: 1000,
      tenant_name: "Zeta",
      lease_start: "2024-01-01",
      lease_end: "2026-01-01",
      monthly_rent: 1000,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "OCCUPIED",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
    {
      id: "2",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "A-1",
      unit_type: null,
      sqft: 800,
      tenant_name: "Alpha",
      lease_start: "2024-01-01",
      lease_end: "2025-12-31",
      monthly_rent: 900,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "OCCUPIED",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
  ];

  const spread = tpl.render({ dealId: "deal", bankId: "bank", facts: [], rentRollRows: rows });

  const unitRowKeys = spread.rows
    .map((r) => r.key)
    .filter((k) => !["TOTAL_OCCUPIED", "TOTAL_VACANT", "TOTALS"].includes(k));

  // Expect order: A-1 Alpha, A-1 Zeta, A-2 (vacant/null tenant)
  assert.equal(unitRowKeys.length, 3);
  assert.ok(unitRowKeys[0]?.includes("ROW:A-1:Alpha"));
  assert.ok(unitRowKeys[1]?.includes("ROW:A-1:Zeta"));
  assert.ok(unitRowKeys[2]?.includes("ROW:A-2:"));
});

test("Rent roll totals compute and occupancy/vacancy pct when sqft available", () => {
  const tpl = rentRollTemplate();

  const rows: RentRollRow[] = [
    {
      id: "1",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "1",
      unit_type: null,
      sqft: 100,
      tenant_name: "T1",
      lease_start: null,
      lease_end: "2026-03-31",
      monthly_rent: 1000,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "OCCUPIED",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
    {
      id: "2",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "2",
      unit_type: null,
      sqft: 100,
      tenant_name: null,
      lease_start: null,
      lease_end: null,
      monthly_rent: null,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "VACANT",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
  ];

  const spread = tpl.render({ dealId: "deal", bankId: "bank", facts: [], rentRollRows: rows });

  assert.equal(spread.totals?.TOTAL_OCCUPIED_RENT_MO, 1000);
  assert.equal(spread.totals?.TOTAL_OCCUPIED_SQFT, 100);
  assert.equal(spread.totals?.TOTAL_SQFT, 200);
  assert.equal(spread.totals?.OCCUPANCY_PCT, 0.5);
  assert.equal(spread.totals?.VACANCY_PCT, 0.5);
});

test("Rent roll occupancy/vacancy pct is null when sqft missing", () => {
  const tpl = rentRollTemplate();

  const rows: RentRollRow[] = [
    {
      id: "1",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "1",
      unit_type: null,
      sqft: null,
      tenant_name: "T1",
      lease_start: null,
      lease_end: "2026-03-31",
      monthly_rent: 1000,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "OCCUPIED",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
    {
      id: "2",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "2",
      unit_type: null,
      sqft: null,
      tenant_name: null,
      lease_start: null,
      lease_end: null,
      monthly_rent: null,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "VACANT",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
  ];

  const spread = tpl.render({ dealId: "deal", bankId: "bank", facts: [], rentRollRows: rows });

  assert.equal(spread.totals?.TOTAL_SQFT, null);
  assert.equal(spread.totals?.OCCUPANCY_PCT, null);
  assert.equal(spread.totals?.VACANCY_PCT, null);
});

test("WALT_YEARS edge cases: null when vacant; zero when lease already ended", () => {
  const tpl = rentRollTemplate();

  const rows: RentRollRow[] = [
    {
      id: "1",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "1",
      unit_type: null,
      sqft: 100,
      tenant_name: "T1",
      lease_start: null,
      lease_end: "2025-03-30",
      monthly_rent: 1000,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "OCCUPIED",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
    {
      id: "2",
      deal_id: "deal",
      bank_id: "bank",
      as_of_date: "2025-03-31",
      unit_id: "2",
      unit_type: null,
      sqft: 100,
      tenant_name: null,
      lease_start: null,
      lease_end: "2026-03-31",
      monthly_rent: null,
      annual_rent: null,
      market_rent_monthly: null,
      occupancy_status: "VACANT",
      concessions_monthly: null,
      notes: null,
      source_document_id: null,
    },
  ];

  const spread = tpl.render({ dealId: "deal", bankId: "bank", facts: [], rentRollRows: rows });

  const occupiedRow = spread.rows.find((r) => r.key.includes("ROW:1:"));
  const vacantRow = spread.rows.find((r) => r.key.includes("ROW:2:"));

  const occWalt = (occupiedRow?.values?.[0] as any)?.valueByCol?.WALT_YEARS;
  const vacWalt = (vacantRow?.values?.[0] as any)?.valueByCol?.WALT_YEARS;

  assert.equal(occWalt, 0);
  assert.equal(vacWalt, null);
});
