/**
 * AR Aging Table Extractor — pure-function tests.
 *
 * Validates the contract that document_extracts.tables_json downstream
 * (parseARAgingTable in arCollateralProcessor) consumes.
 */

import { describe, test } from "node:test";
import assert from "node:assert";
import { extractArAgingTables } from "../arAgingTableExtractor";
import { parseARAgingTable } from "@/lib/processors/arAgingParser";

describe("extractArAgingTables — native tables", () => {
  test("normalizes a native AR aging table with bucket headers", () => {
    const out = extractArAgingTables({
      tables: [
        {
          rows: [
            ["Customer", "Current", "1-30", "31-60", "61-90", "91+", "Total"],
            ["Affinity Cellular", "123.45", "0", "0", "0", "0", "123.45"],
            ["ABC Corp", "1,000.00", "200.00", "0", "0", "0", "1,200.00"],
          ],
        },
      ],
    });
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].source, "native_table");
    assert.equal(out.tables[0].rows.length, 3);
  });

  test("rejects native table that lacks AR aging header", () => {
    const out = extractArAgingTables({
      tables: [
        {
          rows: [
            ["Vendor", "Invoice", "Amount"],
            ["XYZ Vendor", "INV-001", "$500"],
          ],
        },
      ],
    });
    assert.equal(out.tables.length, 0);
  });
});

describe("extractArAgingTables — text reconstruction", () => {
  test("reconstructs AR aging from OCR text with explicit title and headers", () => {
    const text = `
Acme Corp Inc.
Accounts Receivable Aging Report
As of: 04/30/2026

Customer            Current    1-30      31-60     61-90     91+       Total
Affinity Cellular   $123.45    $0.00     $0.00     $0.00     $0.00     $123.45
Beta Industries     $1,000.00  $200.00   $0.00     $0.00     $0.00     $1,200.00
Gamma LLC           $500.00    $50.00    $25.00    $0.00     $0.00     $575.00
Grand Total         $1,623.45  $250.00   $25.00    $0.00     $0.00     $1,898.45
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].source, "text_reconstruction");
    // Header + 3 customer rows (footer "Grand Total" must NOT be included)
    assert.equal(out.tables[0].rows.length, 4);
    assert.equal(out.fields.as_of_date, "2026-04-30");
  });

  test("reconstructs AR aging without explicit title when customer + 3 buckets present", () => {
    const text = `
Customer            Current    1-30      31-60     Total
Affinity            100.00     0.00      0.00      100.00
Beta                500.00     50.00     0.00      550.00
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].source, "text_reconstruction");
    assert.equal(out.tables[0].rows.length, 3);
  });

  test("reconstructs when native tables are absent but text rows exist", () => {
    const text = `
Customer            Current    1-30      31-60     61-90     91+       Total
Acme Corp           $1,234.56  $0.00     $0.00     $0.00     $0.00     $1,234.56
`;
    const out = extractArAgingTables({ text, tables: [] });
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].source, "text_reconstruction");
  });
});

describe("extractArAgingTables — AP-aging negative guard", () => {
  test("does not reconstruct an Accounts Payable Aging report", () => {
    const text = `
Accounts Payable Aging Report
As of: 04/30/2026

Vendor              Current    1-30      31-60     61-90     91+       Total
ABC Supplies        $1,000.00  $0.00     $0.00     $0.00     $0.00     $1,000.00
XYZ Services        $500.00    $0.00     $0.00     $0.00     $0.00     $500.00
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 0);
    assert.equal(out.diagnostics.aging_type, "ap");
    assert.equal(out.diagnostics.reason, "rejected_ap_aging");
  });

  test("reconstructs when AR signals dominate even if AP word appears once", () => {
    const text = `
Accounts Receivable Aging Report
(do not confuse with our accounts payable system)
As of: 04/30/2026

Customer            Current    1-30      31-60     61-90     91+       Total
Affinity            100.00     0.00      0.00      0.00      0.00      100.00
Beta                500.00     50.00     0.00      0.00      0.00      550.00
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 1);
    assert.equal(out.diagnostics.aging_type, "ar");
  });
});

describe("extractArAgingTables — totals row guard", () => {
  test("does not include Grand Total / Total / Sub Total rows in data", () => {
    const text = `
Accounts Receivable Aging
Customer            Current    1-30      31-60     61-90     91+       Total
Affinity            100.00     0.00      0.00      0.00      0.00      100.00
Beta                200.00     0.00      0.00      0.00      0.00      200.00
Total               300.00     0.00      0.00      0.00      0.00      300.00
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 1);
    // header + 2 data rows; Total must be excluded
    assert.equal(out.tables[0].rows.length, 3);
    const customerNames = out.tables[0].rows.slice(1).map((r) => r[0]);
    assert.deepEqual(customerNames, ["Affinity", "Beta"]);
  });
});

describe("extractArAgingTables — currency parsing", () => {
  test("parses parentheses as negatives and strips $ and commas", () => {
    const text = `
Accounts Receivable Aging
Customer            Current    1-30      31-60     61-90     91+       Total
Acme Corp           $1,234.56  ($50.00)  $0.00     $0.00     $0.00     $1,184.56
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 1);
    const dataRow = out.tables[0].rows[1];
    // Customer name + 6 numeric columns
    assert.equal(dataRow[0], "Acme Corp");
    assert.equal(dataRow[1], "1234.56");
    assert.equal(dataRow[2], "-50.00");
    assert.equal(dataRow[6], "1184.56");
  });
});

describe("extractArAgingTables — feeds parseARAgingTable end-to-end", () => {
  test("reconstructed table is parseable by parseARAgingTable", () => {
    const text = `
Accounts Receivable Aging Report
As of: 04/30/2026

Customer            Current    1-30      31-60     61-90     91+       Total
Affinity Cellular   $123.45    $0.00     $0.00     $0.00     $0.00     $123.45
Beta Industries     $1,000.00  $200.00   $0.00     $0.00     $0.00     $1,200.00
Gamma LLC           $500.00    $50.00    $25.00    $10.00    $0.00     $585.00
`;
    const out = extractArAgingTables({ text });
    assert.equal(out.tables.length, 1);

    // Hand the reconstructed table to the downstream parser exactly as
    // document_extracts.tables_json would store it.
    const tablesJson = out.tables.map((t) => ({ rows: t.rows }));
    const parsed = parseARAgingTable(tablesJson);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].customer, "Affinity Cellular");
    assert.equal(parsed[0].current, 123.45);
    assert.equal(parsed[0].total, 123.45);
    assert.equal(parsed[1].customer, "Beta Industries");
    assert.equal(parsed[1].current, 1000);
    assert.equal(parsed[1].d30, 200);
    assert.equal(parsed[1].total, 1200);
    assert.equal(parsed[2].d60, 25);
    assert.equal(parsed[2].d90, 10);
  });
});
