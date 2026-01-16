import test from "node:test";
import assert from "node:assert/strict";

import { applyT12FormulasPerColumn, buildT12Columns, t12Template } from "@/lib/financialSpreads/templates/t12";
import type { FinancialFact } from "@/lib/financialSpreads/types";

test("T12 formulas compute per-column", () => {
  const columns = [
    { key: "2025-02", label: "Feb 2025", kind: "month" as const },
    { key: "TTM", label: "TTM", kind: "ttm" as const },
  ];

  const valuesByRow: Record<string, Record<string, number | null>> = {
    GROSS_RENTAL_INCOME: { "2025-02": 100, TTM: 1200 },
    VACANCY_CONCESSIONS: { "2025-02": 10, TTM: 100 },
    OTHER_INCOME: { "2025-02": 5, TTM: 50 },

    REPAIRS_MAINTENANCE: { "2025-02": 20, TTM: 200 },
    UTILITIES: { "2025-02": 10, TTM: 100 },
    PROPERTY_MANAGEMENT: { "2025-02": 5, TTM: 50 },
    REAL_ESTATE_TAXES: { "2025-02": 8, TTM: 80 },
    INSURANCE: { "2025-02": 4, TTM: 40 },
    PAYROLL: { "2025-02": 3, TTM: 30 },
    MARKETING: { "2025-02": 1, TTM: 10 },
    PROFESSIONAL_FEES: { "2025-02": 2, TTM: 20 },
    OTHER_OPEX: { "2025-02": 6, TTM: 60 },

    REPLACEMENT_RESERVES: { "2025-02": 1.2, TTM: 12 },
    CAPEX: { "2025-02": 2.4, TTM: 24 },

    TOTAL_INCOME: {},
    TOTAL_OPEX: {},
    NOI: {},
    TOTAL_CAPEX: {},
    NET_CASH_FLOW_BEFORE_DEBT: {},
    OPEX_RATIO: {},
    NOI_MARGIN: {},
  };

  applyT12FormulasPerColumn({ valuesByRow, columns, preserveExistingComputed: true });

  assert.equal(valuesByRow.TOTAL_INCOME?.TTM, 1150);
  assert.equal(valuesByRow.TOTAL_OPEX?.TTM, 590);
  assert.equal(valuesByRow.NOI?.TTM, 560);
  assert.equal(valuesByRow.TOTAL_CAPEX?.TTM, 36);
  assert.equal(valuesByRow.NET_CASH_FLOW_BEFORE_DEBT?.TTM, 524);

  assert.equal(valuesByRow.TOTAL_INCOME?.["2025-02"], 95);
  assert.equal(valuesByRow.TOTAL_OPEX?.["2025-02"], 59);
  assert.equal(valuesByRow.NOI?.["2025-02"], 36);

  // Ratio sanity (per column):
  assert.ok(Math.abs((valuesByRow.OPEX_RATIO?.TTM ?? 0) - 590 / 1150) < 1e-9);
  assert.ok(Math.abs((valuesByRow.NOI_MARGIN?.TTM ?? 0) - 560 / 1150) < 1e-9);
  assert.ok(Math.abs((valuesByRow.OPEX_RATIO?.["2025-02"] ?? 0) - 59 / 95) < 1e-9);
  assert.ok(Math.abs((valuesByRow.NOI_MARGIN?.["2025-02"] ?? 0) - 36 / 95) < 1e-9);
});

test("T12 template renders deterministic registries", () => {
  const tpl = t12Template();

  const facts: FinancialFact[] = [
    {
      id: "fact_1",
      deal_id: "deal_1",
      bank_id: "bank_1",
      source_document_id: null,
      fact_type: "T12",
      fact_key: "EFFECTIVE_GROSS_INCOME",
      fact_period_start: null,
      fact_period_end: "2025-03-31",
      fact_value_num: 123,
      fact_value_text: null,
      currency: "USD",
      confidence: 0.9,
      provenance: { as_of_date: "2025-03-31" },
      created_at: "2025-04-01T00:00:00.000Z",
    },
  ];

  const spread = tpl.render({ dealId: "deal_1", bankId: "bank_1", facts });

  assert.equal(spread.schema_version, 3);
  assert.equal(spread.schemaVersion, 3);
  assert.equal(spread.spread_type, "T12");
  assert.ok(Array.isArray(spread.columnsV2));

  // Deterministic ordering: row_registry must match rendered rows.
  assert.deepEqual(spread.meta?.row_registry, spread.rows.map((r) => r.key));

  // Column registry ends with YTD/PY_YTD/TTM.
  const colKeys = (spread.columnsV2 ?? []).map((c) => c.key);
  assert.equal(colKeys[colKeys.length - 3], "YTD");
  assert.equal(colKeys[colKeys.length - 2], "PY_YTD");
  assert.equal(colKeys[colKeys.length - 1], "TTM");

  // Spot-check section + ordering semantics.
  const idxTotalIncome = spread.rows.findIndex((r) => r.key === "TOTAL_INCOME");
  const idxNoi = spread.rows.findIndex((r) => r.key === "NOI");
  const idxTotalOpex = spread.rows.findIndex((r) => r.key === "TOTAL_OPEX");
  assert.ok(idxTotalIncome >= 0);
  assert.ok(idxTotalOpex >= 0);
  assert.ok(idxNoi >= 0);
  assert.ok(idxTotalIncome < idxTotalOpex);
  assert.ok(idxTotalOpex < idxNoi);
});

test("buildT12Columns produces 12 months + aggregates", () => {
  const cols = buildT12Columns("2025-03-31", 12);
  assert.equal(cols.length, 15);
  assert.equal(cols[0]?.key, "2024-04");
  assert.equal(cols[11]?.key, "2025-03");
  assert.equal(cols[12]?.key, "YTD");
  assert.equal(cols[13]?.key, "PY_YTD");
  assert.equal(cols[14]?.key, "TTM");
});
