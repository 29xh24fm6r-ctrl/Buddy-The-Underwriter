import test from "node:test";
import assert from "node:assert/strict";

import {
  extractRows,
  extractFootnotes,
} from "../../../../../scripts/reference-data/build-sba-size-standards";
import { parseSizeStandardRow } from "../parseSizeStandardRow";

/**
 * Markup in the shape eCFR serves for §121.201: a GPO-style table where
 * each row is <ROW> with <ENT> cells. Includes a sector heading, a
 * receipts row, an employee row with a thousands separator, and a
 * footnoted exception row — the four shapes the importer must survive.
 */
const ECFR_TABLE_MARKUP = `
<DIV8 N="121.201">
<TABLE>
  <ROW><ENT I="01">Sector 11—Agriculture, Forestry, Fishing and Hunting</ENT><ENT/><ENT/><ENT/></ROW>
  <ROW><ENT I="01">111110</ENT><ENT>Soybean Farming</ENT><ENT>$2.25</ENT><ENT/></ROW>
  <ROW><ENT I="01">113310</ENT><ENT>Logging</ENT><ENT/><ENT>500</ENT></ROW>
  <ROW><ENT I="01">115310 (Exception 1)</ENT><ENT>Forest Fire Suppression 1</ENT><ENT>$34.0 1</ENT><ENT/></ROW>
  <ROW><ENT I="01">211120</ENT><ENT>Crude Petroleum Extraction</ENT><ENT/><ENT>1,250</ENT></ROW>
</TABLE>
</DIV8>
`;

const HTML_TABLE_MARKUP = `
<table>
  <tr><td>722511</td><td>Full-Service Restaurants</td><td>$12.0</td><td></td></tr>
  <tr><td>332710</td><td>Machine Shops</td><td></td><td>500</td></tr>
</table>
`;

test("extractRows reads GPO-style ROW/ENT markup in document order", () => {
  const rows = extractRows(ECFR_TABLE_MARKUP);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].naicsCell, "Sector 11—Agriculture, Forestry, Fishing and Hunting");
  assert.equal(rows[1].naicsCell, "111110");
  assert.equal(rows[1].titleCell, "Soybean Farming");
  assert.equal(rows[1].receiptsCell, "$2.25");
  assert.equal(rows[1].employeesCell, "");
});

test("extractRows keeps receipts and employees in their own columns", () => {
  const rows = extractRows(ECFR_TABLE_MARKUP);
  const logging = rows.find((r) => r.naicsCell === "113310")!;
  assert.equal(logging.receiptsCell, "");
  assert.equal(logging.employeesCell, "500");

  const crude = rows.find((r) => r.naicsCell === "211120")!;
  assert.equal(crude.receiptsCell, "");
  assert.equal(crude.employeesCell, "1,250");
});

test("extractRows also handles plain HTML table markup", () => {
  const rows = extractRows(HTML_TABLE_MARKUP);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].receiptsCell, "$12.0");
  assert.equal(rows[1].employeesCell, "500");
});

test("extraction feeds the pure parser end to end", () => {
  const parsed = extractRows(ECFR_TABLE_MARKUP).map(parseSizeStandardRow);

  assert.equal(parsed[0].kind, "heading");

  const records = parsed.flatMap((r) => (r.kind === "record" ? [r.record] : []));
  assert.equal(records.length, 4);

  const crude = records.find((r) => r.naics === "211120")!;
  assert.equal(crude.measure, "employees");
  assert.equal(crude.employees, 1250);

  const exception = records.find((r) => r.exceptionLabel === "Exception 1")!;
  assert.equal(exception.naics, "115310");
  assert.equal(exception.receiptsMillionsUsd, 34);
  assert.deepEqual(exception.footnoteRefs, ["1"]);
});

test("extractFootnotes captures numbered footnote text", () => {
  const markup = `
    <P>1 NAICS code 115310 — there are two exceptions concerning forestry support.</P>
    <P>2 NAICS code 237990 — Dredging and surface cleanup activities are described here.</P>
  `;
  const footnotes = extractFootnotes(markup);
  assert.ok(footnotes["1"]?.includes("115310"));
  assert.ok(footnotes["2"]?.includes("237990"));
});
