import test from "node:test";
import assert from "node:assert/strict";

import {
  findHeaderLayout,
  selectTableSheet,
  extractXlsxRows,
  XlsxLayoutError,
  type SheetLike,
} from "../parseXlsxSheet";
import { parseSizeStandardRow } from "../parseSizeStandardRow";

const HEADER = [
  "NAICS Codes",
  "NAICS U.S. Industry Title",
  "Size standards in millions of dollars",
  "Size standards in number of employees",
];

const TABLE_SHEET: SheetLike = {
  name: "Size Standards",
  rows: [
    ["U.S. Small Business Administration", "", "", ""],
    ["Table of Small Business Size Standards", "", "", ""],
    HEADER,
    ["Sector 11—Agriculture, Forestry, Fishing and Hunting", "", "", ""],
    ["111110", "Soybean Farming", "$2.25", ""],
    ["113310", "Logging", "", "500"],
    ["115310 (Exception 1)", "Forest Fire Suppression 1", "$34.0 1", ""],
    ["211120", "Crude Petroleum Extraction", "", "1,250"],
  ],
};

const NOTES_SHEET: SheetLike = {
  name: "Footnotes",
  rows: [["Footnote", "Text"], ["1", "Forestry support exceptions."]],
};

test("findHeaderLayout locates all four columns", () => {
  const layout = findHeaderLayout(TABLE_SHEET.rows);
  assert.ok(layout);
  assert.equal(layout!.headerRowIndex, 2);
  assert.equal(layout!.naicsCol, 0);
  assert.equal(layout!.receiptsCol, 2);
  assert.equal(layout!.employeesCol, 3);
});

test("a header row missing a measure column is not accepted", () => {
  const rows = [["NAICS Codes", "NAICS U.S. Industry Title", "Size standard"]];
  assert.equal(findHeaderLayout(rows), null);
});

test("selectTableSheet ignores sheets without the table header", () => {
  const { sheet } = selectTableSheet([NOTES_SHEET, TABLE_SHEET]);
  assert.equal(sheet.name, "Size Standards");
});

test("multiple table-like sheets are an error, never merged", () => {
  // Regression: the legacy importer looped every worksheet and produced
  // 2,023 six-digit rows for 1,117 unique codes.
  assert.throws(
    () => selectTableSheet([TABLE_SHEET, { ...TABLE_SHEET, name: "Copy" }]),
    (error: unknown) => {
      assert.ok(error instanceof XlsxLayoutError);
      assert.match(error.message, /double-counted/);
      return true;
    },
  );
});

test("no table sheet at all is an error listing what was inspected", () => {
  assert.throws(() => selectTableSheet([NOTES_SHEET]), /Sheets inspected: Footnotes/);
});

test("extractXlsxRows preserves column identity for empty cells", () => {
  const { sheet, layout } = selectTableSheet([TABLE_SHEET]);
  const rows = extractXlsxRows(sheet, layout);

  assert.equal(rows.length, 5); // heading + 4 data rows

  const logging = rows.find((r) => r.naicsCell === "113310")!;
  assert.equal(logging.receiptsCell, "");
  assert.equal(logging.employeesCell, "500");

  const soybean = rows.find((r) => r.naicsCell === "111110")!;
  assert.equal(soybean.receiptsCell, "$2.25");
  assert.equal(soybean.employeesCell, "");
});

test("xlsx rows feed the shared pure parser correctly", () => {
  const { sheet, layout } = selectTableSheet([TABLE_SHEET]);
  const parsed = extractXlsxRows(sheet, layout).map(parseSizeStandardRow);

  const records = parsed.flatMap((r) => (r.kind === "record" ? [r.record] : []));
  assert.equal(records.length, 4);

  const crude = records.find((r) => r.naics === "211120")!;
  assert.equal(crude.measure, "employees");
  assert.equal(crude.employees, 1250);

  const exception = records.find((r) => r.exceptionLabel === "Exception 1")!;
  assert.equal(exception.naics, "115310");
  assert.equal(exception.receiptsMillionsUsd, 34);
});
