import test from "node:test";
import assert from "node:assert/strict";

import { parseSizeStandardRow } from "../parseSizeStandardRow";

/**
 * Regressions locked in from the REAL official workbook
 * (SBA_Table_of_Size_Standards_Effective_March_17_2023.xlsx,
 *  SHA-256 dadfaf90476f27e41ddd3bb9ebeb81e3b98de4fcf7d9a6afaa27961d9efe456f).
 *
 * Every case below is a defect that the first pass over the real file
 * actually produced. Synthetic fixtures did not surface any of them.
 */

test("footnotes come from the Footnotes column, not trailing title digits", () => {
  // 541330 (Exception 2)'s title genuinely ends in "1992". The old
  // trailing-digit heuristic recorded 1992 as a footnote reference and
  // truncated the title.
  const result = parseSizeStandardRow({
    naicsCell: "541330 (Exception 2)",
    titleCell:
      "Contracts and Subcontracts for Engineering Services Awarded Under the National Energy Policy Act of 1992",
    receiptsCell: "47",
    employeesCell: "",
    footnotesCell: "",
    titleFootnoteRefs: [],
  });

  assert.equal(result.kind, "record");
  if (result.kind !== "record") return;
  assert.deepEqual(result.record.footnoteRefs, []);
  assert.ok(result.record.title.endsWith("1992"), "title must keep its year");
});

test("superscript footnote refs are captured and kept out of the title", () => {
  // In the workbook, "Petroleum Refineries" carries a superscript 4.
  const result = parseSizeStandardRow({
    naicsCell: "324110",
    titleCell: "Petroleum Refineries",
    receiptsCell: "",
    employeesCell: "1500",
    footnotesCell: "See footnote 4",
    titleFootnoteRefs: ["4"],
  });

  assert.equal(result.kind, "record");
  if (result.kind !== "record") return;
  assert.equal(result.record.title, "Petroleum Refineries");
  assert.deepEqual(result.record.footnoteRefs, ["4"]);
  assert.equal(result.record.measure, "employees");
  assert.equal(result.record.employees, 1500);
});

test("asset standards are detected from the value cell only", () => {
  const banking = parseSizeStandardRow({
    naicsCell: "522110",
    titleCell: "Commercial Banking",
    receiptsCell: "$850 million in assets",
    employeesCell: "",
    footnotesCell: "See footnote 8",
  });
  assert.equal(banking.kind, "record");
  if (banking.kind !== "record") return;
  assert.equal(banking.record.measure, "assets");
  assert.equal(banking.record.assetsMillionsUsd, 850);
  assert.equal(banking.record.receiptsMillionsUsd, null);
});

test("an industry whose TITLE says 'Assets' is still a receipts standard", () => {
  // NAICS 533110 "Lessors of Nonfinancial Intangible Assets" has a $47M
  // RECEIPTS standard. Matching "assets" in the title recorded it as an
  // asset cap — the right number on the wrong axis.
  const result = parseSizeStandardRow({
    naicsCell: "533110",
    titleCell: "Lessors of Nonfinancial Intangible Assets (except Copyrighted Works)",
    receiptsCell: "47",
    employeesCell: "",
    footnotesCell: "",
  });

  assert.equal(result.kind, "record");
  if (result.kind !== "record") return;
  assert.equal(result.record.measure, "annual_receipts");
  assert.equal(result.record.receiptsMillionsUsd, 47);
  assert.equal(result.record.assetsMillionsUsd, null);
});

test("sector headings with an empty code cell are headings, not malformed", () => {
  const result = parseSizeStandardRow({
    naicsCell: "",
    titleCell: "Sector 11 – Agriculture, Forestry, Fishing and Hunting",
    receiptsCell: "",
    employeesCell: "",
  });
  assert.equal(result.kind, "heading");
});

test("subsector headings in the code column remain headings", () => {
  const result = parseSizeStandardRow({
    naicsCell: "Subsector 111 – Crop Production",
    titleCell: "",
    receiptsCell: "",
    employeesCell: "",
  });
  assert.equal(result.kind, "heading");
});

test("all four real exception shapes parse with distinct identity", () => {
  const rows = [
    { naicsCell: "115310 (Exception 1)", expected: "Exception 1" },
    { naicsCell: "237990 (Exception)", expected: "Exception" },
    { naicsCell: "541715 (Exception 3)", expected: "Exception 3" },
    { naicsCell: "611519 (Exception)", expected: "Exception" },
  ];

  for (const { naicsCell, expected } of rows) {
    const result = parseSizeStandardRow({
      naicsCell,
      titleCell: "Exception industry",
      receiptsCell: "47",
      employeesCell: "",
    });
    assert.equal(result.kind, "record", naicsCell);
    if (result.kind !== "record") continue;
    assert.equal(result.record.exceptionLabel, expected);
    assert.match(result.record.naics, /^\d{6}$/);
  }
});
