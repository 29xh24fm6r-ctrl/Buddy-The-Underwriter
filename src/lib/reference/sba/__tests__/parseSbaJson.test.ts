import test from "node:test";
import assert from "node:assert/strict";

import {
  describeJsonSchema,
  normalizeSbaJson,
  locateRecords,
  SbaJsonSchemaError,
} from "../parseSbaJson";
import { crossCheckRecords } from "../crossCheck";
import type { SbaSizeStandardRecord } from "../types";

/**
 * Hypothetical payload shapes. These are NOT claims about the official
 * file — as of 2026-08-17 both SBA JSON URLs 404, so the real field names
 * are unconfirmed. They exist to prove the probe reports whatever it is
 * given and the normalizer refuses to guess.
 */
const THRESHOLD_BEARING_PAYLOAD = {
  naics: [
    {
      id: "111110",
      description: "Soybean Farming",
      sizeStandardInMillions: "2.25",
      sizeStandardInEmployees: null,
    },
    {
      id: "113310",
      description: "Logging",
      sizeStandardInMillions: null,
      sizeStandardInEmployees: "500",
    },
    {
      id: "211120",
      description: "Crude Petroleum Extraction",
      sizeStandardInMillions: null,
      sizeStandardInEmployees: "1,250",
    },
    // Classification row — sector, not a 6-digit industry.
    { id: "11", description: "Agriculture, Forestry, Fishing and Hunting" },
  ],
};

/** Shape suggested by the published Swagger parameter list: no thresholds. */
const CLASSIFICATION_ONLY_PAYLOAD = {
  naics: [
    {
      id: "111110",
      description: "Soybean Farming",
      sectorId: "11",
      sectorDescription: "Agriculture",
      subsectorId: "111",
      subsectorDescription: "Crop Production",
      parent: "11111",
    },
  ],
};

function record(
  overrides: Partial<SbaSizeStandardRecord> & { naics: string },
): SbaSizeStandardRecord {
  return {
    exceptionLabel: null,
    title: "Industry",
    measure: "annual_receipts",
    receiptsMillionsUsd: 10,
    employees: null,
    assetsMillionsUsd: null,
    footnoteRefs: [],
    raw: { naicsCell: "", titleCell: "", receiptsCell: "", employeesCell: "" },
    ...overrides,
  };
}

// ─── Probe ───────────────────────────────────────────────────────────────

test("locateRecords finds the record array under any wrapper key", () => {
  assert.equal(locateRecords(THRESHOLD_BEARING_PAYLOAD).path, "naics");
  assert.equal(locateRecords({ data: [{ a: 1 }] }).path, "data");
  assert.equal(locateRecords([{ a: 1 }]).rootKind, "array");
});

test("describeJsonSchema reports observed fields and population counts", () => {
  const report = describeJsonSchema(THRESHOLD_BEARING_PAYLOAD);
  assert.equal(report.recordCount, 4);
  const names = report.fields.map((f) => f.name);
  assert.ok(names.includes("sizeStandardInEmployees"));
  assert.equal(report.resolvedMapping.naics, "id");
  assert.equal(report.resolvedMapping.receipts, "sizeStandardInMillions");
});

test("describeJsonSchema surfaces fields the mapping does not consume", () => {
  const report = describeJsonSchema(CLASSIFICATION_ONLY_PAYLOAD);
  assert.ok(report.unmappedFields.includes("sectorId"));
  assert.ok(report.unmappedFields.includes("parent"));
});

// ─── The refusal to guess ────────────────────────────────────────────────

test("classification-only JSON is rejected, not silently normalized", () => {
  assert.throws(
    () => normalizeSbaJson(CLASSIFICATION_ONLY_PAYLOAD),
    (error: unknown) => {
      assert.ok(error instanceof SbaJsonSchemaError);
      assert.match(error.message, /classification-only/i);
      // The probe report rides along so a human can see the real schema.
      assert.ok(error.report.fields.length > 0);
      return true;
    },
  );
});

test("a payload with no NAICS field is rejected with the observed fields listed", () => {
  assert.throws(
    () => normalizeSbaJson({ rows: [{ foo: "bar", sizeStandardInMillions: "1" }] }),
    /Could not locate a NAICS code field[\s\S]*foo/,
  );
});

test("an empty payload is rejected", () => {
  assert.throws(() => normalizeSbaJson({ naics: [] }), /no record array/i);
});

// ─── Normalization ───────────────────────────────────────────────────────

test("threshold-bearing JSON normalizes with measures kept on the right axis", () => {
  const { records, rejected } = normalizeSbaJson(THRESHOLD_BEARING_PAYLOAD);
  assert.equal(records.length, 3);

  const soybean = records.find((r) => r.naics === "111110")!;
  assert.equal(soybean.measure, "annual_receipts");
  assert.equal(soybean.receiptsMillionsUsd, 2.25);

  const crude = records.find((r) => r.naics === "211120")!;
  assert.equal(crude.measure, "employees");
  assert.equal(crude.employees, 1250);
  assert.equal(crude.receiptsMillionsUsd, null);

  // The sector row is rejected, not coerced into a 6-digit code.
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /not a 6-digit/);
});

test("a record carrying both thresholds is rejected as ambiguous", () => {
  const { records, rejected } = normalizeSbaJson({
    naics: [
      {
        id: "722511",
        description: "Full-Service Restaurants",
        sizeStandardInMillions: "12.0",
        sizeStandardInEmployees: "500",
      },
    ],
  });
  assert.equal(records.length, 0);
  assert.match(rejected[0].reason, /both receipts and employee/i);
});

// ─── Cross-check STOP rule ───────────────────────────────────────────────

test("identical sources produce no material discrepancies", () => {
  const rows = [record({ naics: "111110", receiptsMillionsUsd: 2.25 })];
  const result = crossCheckRecords({
    base: rows,
    reference: rows,
    baseLabel: "JSON",
    referenceLabel: "XLSX",
  });
  assert.equal(result.materialCount, 0);
});

test("a threshold disagreement is material", () => {
  const result = crossCheckRecords({
    base: [record({ naics: "722511", receiptsMillionsUsd: 12 })],
    reference: [record({ naics: "722511", receiptsMillionsUsd: 12.5 })],
    baseLabel: "JSON",
    referenceLabel: "XLSX",
  });
  assert.equal(result.materialCount, 1);
  assert.equal(result.discrepancies[0].kind, "threshold_mismatch");
});

test("a measure disagreement is material", () => {
  const result = crossCheckRecords({
    base: [record({ naics: "211120", receiptsMillionsUsd: 1250 })],
    reference: [
      record({
        naics: "211120",
        measure: "employees",
        receiptsMillionsUsd: null,
        employees: 1250,
      }),
    ],
    baseLabel: "JSON",
    referenceLabel: "121.201",
  });
  assert.equal(result.materialCount, 1);
  assert.equal(result.discrepancies[0].kind, "measure_mismatch");
});

test("an exception row missing from the base source is material", () => {
  const base = [record({ naics: "115310", receiptsMillionsUsd: 11.5 })];
  const reference = [
    ...base,
    record({
      naics: "115310",
      exceptionLabel: "Exception 1",
      receiptsMillionsUsd: 34,
    }),
  ];
  const result = crossCheckRecords({
    base,
    reference,
    baseLabel: "JSON",
    referenceLabel: "121.201",
  });
  assert.equal(result.materialCount, 1);
  assert.equal(result.discrepancies[0].kind, "missing_in_base");
  assert.match(result.discrepancies[0].detail, /supplemented/i);
});

test("title punctuation differences are informational, not blocking", () => {
  const result = crossCheckRecords({
    base: [record({ naics: "111110", title: "Soybean Farming" })],
    reference: [record({ naics: "111110", title: "SOYBEAN FARMING" })],
    baseLabel: "JSON",
    referenceLabel: "XLSX",
  });
  assert.equal(result.materialCount, 0);
});

test("a partial reference does not flag base-only codes", () => {
  const result = crossCheckRecords({
    base: [record({ naics: "111110" }), record({ naics: "722511" })],
    reference: [record({ naics: "111110" })],
    baseLabel: "JSON",
    referenceLabel: "121.201 spot-check",
    referenceIsPartial: true,
  });
  assert.equal(result.materialCount, 0);
});
