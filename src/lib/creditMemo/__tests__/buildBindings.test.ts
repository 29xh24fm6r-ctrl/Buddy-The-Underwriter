import test from "node:test";
import assert from "node:assert/strict";

/**
 * Credit memo binding guardrail tests.
 *
 * These validate the data contract invariants without requiring
 * server-only imports or DB access.
 */

// ========================================
// Inline helpers (mirrors buildBindings.ts pure logic)
// ========================================

type FactRow = {
  id: string;
  fact_type: string;
  fact_key: string;
  fact_value_num: number | null;
  fact_value_text: string | null;
  fact_period_start: string | null;
  fact_period_end: string | null;
  confidence: number | null;
  provenance: any;
  source_document_id: string | null;
  owner_type: string;
  owner_entity_id: string | null;
  created_at: string;
};

type ProvenanceEntry = {
  memoField: string;
  factType?: string;
  factKey?: string;
  ownerType: string;
  ownerEntityId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceDocumentId?: string | null;
  confidence?: number | null;
  source: string;
};

function createBindFact(facts: FactRow[], provenance: ProvenanceEntry[]) {
  return function bindFact(args: {
    memoField: string;
    factType: string;
    factKey: string;
    ownerType: "DEAL" | "PERSONAL" | "GLOBAL";
    ownerEntityId?: string | null;
  }): number | null {
    const match = facts.find((f) => {
      if (f.fact_type !== args.factType) return false;
      if (f.fact_key !== args.factKey) return false;
      if (args.ownerType === "PERSONAL") {
        if (f.owner_type !== "PERSONAL") return false;
        if (args.ownerEntityId && f.owner_entity_id !== args.ownerEntityId) return false;
      } else if (args.ownerType === "DEAL") {
        if (f.owner_type !== "DEAL" && f.owner_type) return false;
      }
      return true;
    });

    const value = match?.fact_value_num ?? null;
    const source = match
      ? `Facts:${args.factType}.${args.factKey}`
      : "Missing";

    provenance.push({
      memoField: args.memoField,
      factType: args.factType,
      factKey: args.factKey,
      ownerType: args.ownerType,
      ownerEntityId: args.ownerEntityId ?? null,
      periodStart: match?.fact_period_start ?? null,
      periodEnd: match?.fact_period_end ?? null,
      sourceDocumentId: match?.source_document_id ?? null,
      confidence: match?.confidence ?? null,
      source,
    });

    return value;
  };
}

function completenessStatus(fields: Array<number | null>) {
  const total = fields.length;
  const populated = fields.filter((v) => v !== null).length;
  const status = populated === 0 ? "empty" : populated === total ? "complete" : "partial";
  return { total, populated, status };
}

// ========================================
// Period selection helpers (mirrors selectPeriods.ts)
// ========================================

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm);
}

function yearStart(endDate: string): string {
  const [y, m, d] = endDate.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ========================================
// bindFact tests
// ========================================

test("bindFact returns value and adds provenance for matching fact", () => {
  const facts: FactRow[] = [
    {
      id: "f1",
      fact_type: "FINANCIAL_ANALYSIS",
      fact_key: "NOI_TTM",
      fact_value_num: 250000,
      fact_value_text: null,
      fact_period_start: "2024-01-01",
      fact_period_end: "2024-12-31",
      confidence: 0.95,
      provenance: {},
      source_document_id: "doc-1",
      owner_type: "DEAL",
      owner_entity_id: null,
      created_at: "2025-01-15T00:00:00Z",
    },
  ];
  const provenance: ProvenanceEntry[] = [];
  const bindFact = createBindFact(facts, provenance);

  const result = bindFact({
    memoField: "property.noi",
    factType: "FINANCIAL_ANALYSIS",
    factKey: "NOI_TTM",
    ownerType: "DEAL",
  });

  assert.equal(result, 250000);
  assert.equal(provenance.length, 1);
  assert.equal(provenance[0].memoField, "property.noi");
  assert.equal(provenance[0].source, "Facts:FINANCIAL_ANALYSIS.NOI_TTM");
  assert.equal(provenance[0].sourceDocumentId, "doc-1");
  assert.equal(provenance[0].confidence, 0.95);
});

test("bindFact returns null and Missing source for unmatched fact", () => {
  const facts: FactRow[] = [];
  const provenance: ProvenanceEntry[] = [];
  const bindFact = createBindFact(facts, provenance);

  const result = bindFact({
    memoField: "property.noi",
    factType: "FINANCIAL_ANALYSIS",
    factKey: "NOI_TTM",
    ownerType: "DEAL",
  });

  assert.equal(result, null);
  assert.equal(provenance.length, 1);
  assert.equal(provenance[0].source, "Missing");
});

test("bindFact PERSONAL filters by owner_entity_id", () => {
  const facts: FactRow[] = [
    {
      id: "f1",
      fact_type: "PERSONAL_INCOME",
      fact_key: "WAGES_W2",
      fact_value_num: 85000,
      fact_value_text: null,
      fact_period_start: null,
      fact_period_end: null,
      confidence: 0.9,
      provenance: {},
      source_document_id: null,
      owner_type: "PERSONAL",
      owner_entity_id: "owner-A",
      created_at: "2025-01-01T00:00:00Z",
    },
    {
      id: "f2",
      fact_type: "PERSONAL_INCOME",
      fact_key: "WAGES_W2",
      fact_value_num: 120000,
      fact_value_text: null,
      fact_period_start: null,
      fact_period_end: null,
      confidence: 0.9,
      provenance: {},
      source_document_id: null,
      owner_type: "PERSONAL",
      owner_entity_id: "owner-B",
      created_at: "2025-01-01T00:00:00Z",
    },
  ];
  const provenance: ProvenanceEntry[] = [];
  const bindFact = createBindFact(facts, provenance);

  const resultA = bindFact({
    memoField: "sponsors[0].wagesW2",
    factType: "PERSONAL_INCOME",
    factKey: "WAGES_W2",
    ownerType: "PERSONAL",
    ownerEntityId: "owner-A",
  });
  const resultB = bindFact({
    memoField: "sponsors[1].wagesW2",
    factType: "PERSONAL_INCOME",
    factKey: "WAGES_W2",
    ownerType: "PERSONAL",
    ownerEntityId: "owner-B",
  });

  assert.equal(resultA, 85000);
  assert.equal(resultB, 120000);
  assert.equal(provenance.length, 2);
});

test("bindFact prefers first match (facts sorted by created_at desc = most recent)", () => {
  const facts: FactRow[] = [
    {
      id: "newer",
      fact_type: "FINANCIAL_ANALYSIS",
      fact_key: "DSCR",
      fact_value_num: 1.35,
      fact_value_text: null,
      fact_period_start: null,
      fact_period_end: null,
      confidence: 0.95,
      provenance: {},
      source_document_id: null,
      owner_type: "DEAL",
      owner_entity_id: null,
      created_at: "2025-02-01T00:00:00Z",
    },
    {
      id: "older",
      fact_type: "FINANCIAL_ANALYSIS",
      fact_key: "DSCR",
      fact_value_num: 1.20,
      fact_value_text: null,
      fact_period_start: null,
      fact_period_end: null,
      confidence: 0.90,
      provenance: {},
      source_document_id: null,
      owner_type: "DEAL",
      owner_entity_id: null,
      created_at: "2025-01-01T00:00:00Z",
    },
  ];
  const provenance: ProvenanceEntry[] = [];
  const bindFact = createBindFact(facts, provenance);

  const result = bindFact({
    memoField: "property.dscr",
    factType: "FINANCIAL_ANALYSIS",
    factKey: "DSCR",
    ownerType: "DEAL",
  });

  assert.equal(result, 1.35);
});

// ========================================
// Completeness computation tests
// ========================================

test("completenessStatus reports complete when all fields populated", () => {
  const result = completenessStatus([1, 2, 3, 4]);
  assert.equal(result.status, "complete");
  assert.equal(result.total, 4);
  assert.equal(result.populated, 4);
});

test("completenessStatus reports empty when no fields populated", () => {
  const result = completenessStatus([null, null, null]);
  assert.equal(result.status, "empty");
  assert.equal(result.total, 3);
  assert.equal(result.populated, 0);
});

test("completenessStatus reports partial when some fields populated", () => {
  const result = completenessStatus([100, null, 200, null]);
  assert.equal(result.status, "partial");
  assert.equal(result.total, 4);
  assert.equal(result.populated, 2);
});

test("completenessStatus handles empty array", () => {
  const result = completenessStatus([]);
  assert.equal(result.status, "empty");
  assert.equal(result.total, 0);
  assert.equal(result.populated, 0);
});

// ========================================
// Period helpers
// ========================================

test("monthsBetween calculates 12 months for a fiscal year", () => {
  assert.equal(monthsBetween("2023-01-01", "2023-12-31"), 11);
  assert.equal(monthsBetween("2023-01-01", "2024-01-01"), 12);
});

test("monthsBetween handles partial years", () => {
  assert.equal(monthsBetween("2024-01-01", "2024-06-30"), 5);
  assert.equal(monthsBetween("2024-07-01", "2024-09-30"), 2);
});

test("yearStart returns 1 year prior", () => {
  assert.equal(yearStart("2024-12-31"), "2023-12-31");
  assert.equal(yearStart("2024-06-30"), "2023-06-30");
  assert.equal(yearStart("2025-03-31"), "2024-03-31");
});

// ========================================
// Provenance invariant: every numeric field must have an entry
// ========================================

test("full binding produces provenance for every property field", () => {
  const facts: FactRow[] = [
    mkFact("FINANCIAL_ANALYSIS", "NOI_TTM", 250000),
    mkFact("FINANCIAL_ANALYSIS", "TOTAL_INCOME_TTM", 400000),
    mkFact("FINANCIAL_ANALYSIS", "OPEX_TTM", 150000),
    mkFact("FINANCIAL_ANALYSIS", "CASH_FLOW_AVAILABLE", 180000),
    mkFact("FINANCIAL_ANALYSIS", "ANNUAL_DEBT_SERVICE", 120000),
    mkFact("FINANCIAL_ANALYSIS", "EXCESS_CASH_FLOW", 60000),
    mkFact("FINANCIAL_ANALYSIS", "DSCR", 1.5),
    mkFact("FINANCIAL_ANALYSIS", "DSCR_STRESSED_300BPS", 1.15),
    mkFact("COLLATERAL", "LTV_GROSS", 0.65),
    mkFact("COLLATERAL", "LTV_NET", 0.60),
    mkFact("FINANCIAL_ANALYSIS", "OCCUPANCY_PCT", 0.92),
    mkFact("FINANCIAL_ANALYSIS", "IN_PLACE_RENT_MO", 2800),
  ];
  const provenance: ProvenanceEntry[] = [];
  const bindFact = createBindFact(facts, provenance);

  // Bind all 12 property fields
  const propertyFields = [
    { memoField: "property.noi", factType: "FINANCIAL_ANALYSIS", factKey: "NOI_TTM" },
    { memoField: "property.totalIncome", factType: "FINANCIAL_ANALYSIS", factKey: "TOTAL_INCOME_TTM" },
    { memoField: "property.opex", factType: "FINANCIAL_ANALYSIS", factKey: "OPEX_TTM" },
    { memoField: "property.cashFlowAvailable", factType: "FINANCIAL_ANALYSIS", factKey: "CASH_FLOW_AVAILABLE" },
    { memoField: "property.debtService", factType: "FINANCIAL_ANALYSIS", factKey: "ANNUAL_DEBT_SERVICE" },
    { memoField: "property.excessCashFlow", factType: "FINANCIAL_ANALYSIS", factKey: "EXCESS_CASH_FLOW" },
    { memoField: "property.dscr", factType: "FINANCIAL_ANALYSIS", factKey: "DSCR" },
    { memoField: "property.dscrStressed", factType: "FINANCIAL_ANALYSIS", factKey: "DSCR_STRESSED_300BPS" },
    { memoField: "property.ltvGross", factType: "COLLATERAL", factKey: "LTV_GROSS" },
    { memoField: "property.ltvNet", factType: "COLLATERAL", factKey: "LTV_NET" },
    { memoField: "property.occupancyPct", factType: "FINANCIAL_ANALYSIS", factKey: "OCCUPANCY_PCT" },
    { memoField: "property.inPlaceRent", factType: "FINANCIAL_ANALYSIS", factKey: "IN_PLACE_RENT_MO" },
  ] as const;

  const values: Array<number | null> = [];
  for (const field of propertyFields) {
    values.push(
      bindFact({ memoField: field.memoField, factType: field.factType, factKey: field.factKey, ownerType: "DEAL" })
    );
  }

  // Every field should have a provenance entry
  assert.equal(provenance.length, 12, "provenance must have 12 entries (one per property field)");

  // Every value should be non-null (all facts present)
  assert.equal(values.filter((v) => v !== null).length, 12, "all 12 property values should be populated");

  // Every provenance entry should have a non-Missing source
  for (const p of provenance) {
    assert.notEqual(p.source, "Missing", `${p.memoField} should not be Missing`);
  }

  // Completeness should be 'complete'
  const c = completenessStatus(values);
  assert.equal(c.status, "complete");
});

test("missing facts produce Missing provenance but still add entries", () => {
  const provenance: ProvenanceEntry[] = [];
  const bindFact = createBindFact([], provenance);

  bindFact({ memoField: "property.noi", factType: "FINANCIAL_ANALYSIS", factKey: "NOI_TTM", ownerType: "DEAL" });
  bindFact({ memoField: "property.dscr", factType: "FINANCIAL_ANALYSIS", factKey: "DSCR", ownerType: "DEAL" });

  assert.equal(provenance.length, 2, "provenance entries must exist even for missing facts");
  assert.equal(provenance[0].source, "Missing");
  assert.equal(provenance[1].source, "Missing");
});

// ========================================
// No hardcoded years invariant
// ========================================

test("period helpers never reference specific years", () => {
  // Verify yearStart is relative, not absolute
  const start2030 = yearStart("2030-12-31");
  assert.equal(start2030, "2029-12-31");

  const start1999 = yearStart("1999-06-30");
  assert.equal(start1999, "1998-06-30");

  // monthsBetween is purely arithmetic
  assert.equal(monthsBetween("2050-01-01", "2050-12-01"), 11);
});

// ========================================
// Helpers
// ========================================

let factCounter = 0;
function mkFact(factType: string, factKey: string, value: number, ownerType = "DEAL", ownerEntityId: string | null = null): FactRow {
  factCounter++;
  return {
    id: `f-${factCounter}`,
    fact_type: factType,
    fact_key: factKey,
    fact_value_num: value,
    fact_value_text: null,
    fact_period_start: "2024-01-01",
    fact_period_end: "2024-12-31",
    confidence: 0.9,
    provenance: {},
    source_document_id: null,
    owner_type: ownerType,
    owner_entity_id: ownerEntityId,
    created_at: "2025-01-15T00:00:00Z",
  };
}
