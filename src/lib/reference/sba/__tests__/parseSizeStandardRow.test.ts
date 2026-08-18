import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSizeStandardRow,
  parseStandardValue,
  splitFootnoteRefs,
  recordKey,
  type RawSizeStandardRow,
} from "../parseSizeStandardRow";
import {
  ECFR_FIXTURE_ROWS,
  MALFORMED_FIXTURE_ROWS,
} from "../__fixtures__/ecfrRows";

function recordFor(naicsCell: string) {
  const row = ECFR_FIXTURE_ROWS.find((r) => r.naicsCell === naicsCell);
  assert.ok(row, `fixture missing row ${naicsCell}`);
  const result = parseSizeStandardRow(row!);
  assert.equal(result.kind, "record", `expected ${naicsCell} to parse`);
  return result.kind === "record" ? result.record : null!;
}

// ─── Value parsing ────────────────────────────────────────────────────────

test("parseStandardValue strips currency and thousands separators", () => {
  assert.equal(parseStandardValue("$2.25"), 2.25);
  assert.equal(parseStandardValue("$47.0"), 47);
  assert.equal(parseStandardValue("1,250"), 1250);
  assert.equal(parseStandardValue("500"), 500);
});

test("parseStandardValue returns null for empty, never NaN", () => {
  assert.equal(parseStandardValue(""), null);
  assert.equal(parseStandardValue("   "), null);
  assert.equal(parseStandardValue("see footnote"), null);
});

test("splitFootnoteRefs does not mistake a bare value for a footnote", () => {
  // Regression: "500" is Logging's employee standard, not footnote 500.
  assert.deepEqual(splitFootnoteRefs("500"), { text: "500", refs: [] });
  assert.deepEqual(splitFootnoteRefs("$34.0 1"), { text: "$34.0", refs: ["1"] });
  assert.deepEqual(splitFootnoteRefs("1,500 4"), {
    text: "1,500",
    refs: ["4"],
  });
});

// ─── Structural classification ───────────────────────────────────────────

test("sector and subsector headings are classified as headings", () => {
  const sector = parseSizeStandardRow(ECFR_FIXTURE_ROWS[0]);
  const subsector = parseSizeStandardRow(ECFR_FIXTURE_ROWS[1]);
  assert.equal(sector.kind, "heading");
  assert.equal(subsector.kind, "heading");
});

test("receipts-based rows record millions as published, not dollars", () => {
  const soybean = recordFor("111110");
  assert.equal(soybean.measure, "annual_receipts");
  assert.equal(soybean.receiptsMillionsUsd, 2.25);
  assert.equal(soybean.employees, null);
  assert.equal(soybean.assetsMillionsUsd, null);
});

test("employee-based rows are never misread as revenue (211120 regression)", () => {
  // The legacy importer recorded this row as $1,250,000,000 of revenue.
  const crude = recordFor("211120");
  assert.equal(crude.measure, "employees");
  assert.equal(crude.employees, 1250);
  assert.equal(crude.receiptsMillionsUsd, null);
});

test("a bare employee count is a value, not a footnote", () => {
  const logging = recordFor("113310");
  assert.equal(logging.measure, "employees");
  assert.equal(logging.employees, 500);
  assert.deepEqual(logging.footnoteRefs, []);
});

// ─── Exceptions ──────────────────────────────────────────────────────────

test("numbered exception rows are preserved distinctly from their base row", () => {
  const base = recordFor("115310");
  const ex1 = recordFor("115310 (Exception 1)");
  const ex2 = recordFor("115310 (Exception 2)");

  assert.equal(base.exceptionLabel, null);
  assert.equal(base.receiptsMillionsUsd, 11.5);

  assert.equal(ex1.naics, "115310");
  assert.equal(ex1.exceptionLabel, "Exception 1");
  assert.equal(ex1.receiptsMillionsUsd, 34);
  assert.equal(ex2.exceptionLabel, "Exception 2");

  // Identity must not collide — this is what prevents flattening.
  const keys = new Set([recordKey(base), recordKey(ex1), recordKey(ex2)]);
  assert.equal(keys.size, 3);
});

test("unnumbered exception rows are preserved", () => {
  const dredging = recordFor("237900 (Exception)");
  assert.equal(dredging.naics, "237900");
  assert.equal(dredging.exceptionLabel, "Exception");
  assert.equal(dredging.receiptsMillionsUsd, 37);
  assert.deepEqual(dredging.footnoteRefs, ["2"]);
});

test("footnote refs are collected from title and value cells and deduped", () => {
  const refineries = recordFor("324110");
  assert.equal(refineries.measure, "employees");
  assert.equal(refineries.employees, 1500);
  assert.deepEqual(refineries.footnoteRefs, ["4"]);
});

test("titles are stored with footnote markers stripped", () => {
  assert.equal(recordFor("324110").title, "Petroleum Refineries");
  assert.equal(recordFor("115310 (Exception 1)").title, "Forest Fire Suppression");
});

// ─── Provenance ──────────────────────────────────────────────────────────

test("raw source cells are preserved verbatim on every record", () => {
  const crude = recordFor("211120");
  assert.equal(crude.raw.employeesCell, "1,250");
  assert.equal(crude.raw.titleCell, "Crude Petroleum Extraction");

  const ex1 = recordFor("115310 (Exception 1)");
  assert.equal(ex1.raw.receiptsCell, "$34.0 1");
  assert.equal(ex1.raw.naicsCell, "115310 (Exception 1)");
});

// ─── Malformed input is surfaced, never coerced ──────────────────────────

test("a non-6-digit NAICS cell is malformed, not silently accepted", () => {
  const result = parseSizeStandardRow(MALFORMED_FIXTURE_ROWS[0]);
  assert.equal(result.kind, "malformed");
});

test("both columns populated is malformed — signals column misalignment", () => {
  const result = parseSizeStandardRow(MALFORMED_FIXTURE_ROWS[1]);
  assert.equal(result.kind, "malformed");
  if (result.kind === "malformed") {
    assert.match(result.reason, /misaligned/i);
  }
});

test("a non-empty unparseable value is malformed, not a null threshold", () => {
  const result = parseSizeStandardRow(MALFORMED_FIXTURE_ROWS[2]);
  assert.equal(result.kind, "malformed");
  if (result.kind === "malformed") {
    assert.match(result.reason, /unparseable receipts/i);
  }
});

test("every non-heading fixture row parses to a record", () => {
  const rows: RawSizeStandardRow[] = ECFR_FIXTURE_ROWS.slice(2);
  for (const row of rows) {
    const result = parseSizeStandardRow(row);
    assert.equal(
      result.kind,
      "record",
      `row ${row.naicsCell} did not parse: ${JSON.stringify(result)}`,
    );
  }
});
