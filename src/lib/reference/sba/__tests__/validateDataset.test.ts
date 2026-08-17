import test from "node:test";
import assert from "node:assert/strict";

import {
  validateDataset,
  assertDatasetValid,
  computeCounts,
  MIN_UNIQUE_NAICS,
} from "../validateDataset";
import type {
  SbaSizeStandardDataset,
  SbaSizeStandardRecord,
} from "../types";

function record(
  overrides: Partial<SbaSizeStandardRecord> & { naics: string },
): SbaSizeStandardRecord {
  return {
    exceptionLabel: null,
    title: "Test Industry",
    measure: "annual_receipts",
    receiptsMillionsUsd: 10,
    employees: null,
    assetsMillionsUsd: null,
    footnoteRefs: [],
    raw: {
      naicsCell: overrides.naics,
      titleCell: "Test Industry",
      receiptsCell: "$10.0",
      employeesCell: "",
    },
    ...overrides,
  };
}

/** Synthesizes a structurally valid dataset of the expected magnitude. */
function validDataset(
  overrides: Partial<SbaSizeStandardDataset> = {},
): SbaSizeStandardDataset {
  const records: SbaSizeStandardRecord[] = [];
  for (let i = 0; i < 1_050; i++) {
    const naics = String(110_000 + i);
    records.push(
      i % 3 === 0
        ? record({
            naics,
            measure: "employees",
            receiptsMillionsUsd: null,
            employees: 500,
          })
        : record({ naics }),
    );
  }
  // One exception row sharing a base code.
  records.push(
    record({
      naics: "110000",
      exceptionLabel: "Exception 1",
      measure: "annual_receipts",
      receiptsMillionsUsd: 34,
      employees: null,
      footnoteRefs: ["1"],
    }),
  );

  const base: SbaSizeStandardDataset = {
    version: "2023-03",
    effectiveDate: "2023-03-17",
    sourceName: "13 CFR 121.201",
    sourceUrl: "https://www.ecfr.gov/current/title-13/part-121/section-121.201",
    sourceSha256: "a".repeat(64),
    importedAt: "2026-08-17T00:00:00.000Z",
    footnotes: { "1": "Test footnote." },
    counts: computeCounts(records),
    records,
  };

  const merged = { ...base, ...overrides };
  if (!overrides.counts) merged.counts = computeCounts(merged.records);
  return merged;
}

const errorCodes = (d: SbaSizeStandardDataset) =>
  validateDataset(d)
    .filter((i) => i.severity === "error")
    .map((i) => i.code);

// ─── Happy path ──────────────────────────────────────────────────────────

test("a well-formed dataset validates clean", () => {
  assert.deepEqual(errorCodes(validDataset()), []);
  assert.doesNotThrow(() => assertDatasetValid(validDataset()));
});

// ─── The core guarantee: no more placeholder tables ─────────────────────

test("a ~50-code placeholder table is rejected", () => {
  const records = Array.from({ length: 52 }, (_, i) =>
    record({ naics: String(722_000 + i) }),
  );
  const codes = errorCodes(validDataset({ records, counts: computeCounts(records) }));
  assert.ok(
    codes.includes("insufficient_coverage"),
    "a 52-code table must fail coverage validation",
  );
});

test("coverage floor sits just below the verified official count", () => {
  // The official workbook (SHA-256 dadfaf90…456f) carries 978 unique
  // six-digit codes. The floor must be below that so a legitimate import
  // passes, and far above placeholder scale so a partial one fails.
  assert.ok(MIN_UNIQUE_NAICS < 978, "floor must not reject the real dataset");
  assert.ok(MIN_UNIQUE_NAICS > 500, "floor must still catch a partial import");
});

// ─── The legacy importer's failure modes ────────────────────────────────

test("a dataset that is mostly unclassified is rejected", () => {
  // Mirrors the legacy artifact: ~50% of rows with no usable measure.
  const records = Array.from({ length: 1_050 }, (_, i) =>
    i % 2 === 0
      ? record({ naics: String(110_000 + i) })
      : record({
          naics: String(110_000 + i),
          measure: "other",
          receiptsMillionsUsd: null,
        }),
  );
  records.push(record({ naics: "110000", exceptionLabel: "Exception 1" }));
  const codes = errorCodes(validDataset({ records, counts: computeCounts(records) }));
  assert.ok(codes.includes("excessive_unclassified"));
});

test("double-read rows are caught as duplicates", () => {
  const d = validDataset();
  d.records.push({ ...d.records[0] });
  d.counts = computeCounts(d.records);
  assert.ok(errorCodes(d).includes("duplicate_record"));
});

test("flattened exception rows are caught", () => {
  const d = validDataset();
  d.records = d.records.filter((r) => r.exceptionLabel == null);
  d.counts = computeCounts(d.records);
  assert.ok(errorCodes(d).includes("no_exception_rows"));
});

test("a table with only one measure type is rejected", () => {
  const d = validDataset();
  d.records = d.records.map((r) => ({
    ...r,
    measure: "annual_receipts" as const,
    receiptsMillionsUsd: 10,
    employees: null,
  }));
  d.counts = computeCounts(d.records);
  assert.ok(errorCodes(d).includes("missing_measure_type"));
});

// ─── Provenance is mandatory ────────────────────────────────────────────

test("a dataset without a real source hash is rejected", () => {
  assert.ok(errorCodes(validDataset({ sourceSha256: "" })).includes("bad_source_hash"));
  assert.ok(
    errorCodes(validDataset({ sourceSha256: "not-a-hash" })).includes("bad_source_hash"),
  );
});

test("a non-ISO effective date is rejected", () => {
  assert.ok(
    errorCodes(validDataset({ effectiveDate: "March 17, 2023" })).includes(
      "bad_effective_date",
    ),
  );
});

test("declared counts must match the actual records", () => {
  const d = validDataset();
  d.counts = { ...d.counts, uniqueNaics: d.counts.uniqueNaics + 5 };
  assert.ok(errorCodes(d).includes("counts_mismatch"));
});

// ─── Per-record integrity ───────────────────────────────────────────────

test("a record carrying two thresholds is rejected", () => {
  const d = validDataset();
  d.records[1] = record({
    naics: d.records[1].naics,
    receiptsMillionsUsd: 10,
    employees: 500,
  });
  d.counts = computeCounts(d.records);
  assert.ok(errorCodes(d).includes("threshold_cardinality"));
});

test("an employee standard must be a whole number", () => {
  const d = validDataset();
  d.records[0] = record({
    naics: d.records[0].naics,
    measure: "employees",
    receiptsMillionsUsd: null,
    employees: 500.5,
  });
  d.counts = computeCounts(d.records);
  assert.ok(errorCodes(d).includes("fractional_employees"));
});

test("a zero or negative threshold is rejected", () => {
  const d = validDataset();
  d.records[1] = record({ naics: d.records[1].naics, receiptsMillionsUsd: 0 });
  d.counts = computeCounts(d.records);
  assert.ok(errorCodes(d).includes("bad_threshold"));
});

test("assertDatasetValid throws with every error listed", () => {
  const records = Array.from({ length: 10 }, (_, i) =>
    record({ naics: String(722_000 + i) }),
  );
  assert.throws(
    () =>
      assertDatasetValid(
        validDataset({ records, counts: computeCounts(records), sourceSha256: "x" }),
      ),
    /insufficient_coverage[\s\S]*bad_source_hash|bad_source_hash[\s\S]*insufficient_coverage/,
  );
});
