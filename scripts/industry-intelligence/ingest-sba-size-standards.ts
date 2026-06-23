/**
 * Ingest SBA Size Standards → static JSON
 *
 * Source: SBA Table of Size Standards (XLSX)
 * URL: https://www.sba.gov/sites/default/files/2023-06/Table%20of%20Size%20Standards_Effective%20March%2017%2C%202023_.xlsx
 * Output: data/industry-intelligence/sba-size-standards.json
 *
 * Run: npx tsx scripts/industry-intelligence/ingest-sba-size-standards.ts
 */

import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

type SbaSizeStandard = {
  naics_code: string;
  naics_title: string;
  size_standard: string;
  size_standard_type: "revenue" | "employees" | "other";
  size_standard_value: number | null;
  size_standard_unit: string;
};

const INPUT = resolve("/tmp/sba_size.xlsx");
const OUTPUT = resolve(__dirname, "../../data/industry-intelligence/sba-size-standards.json");

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(INPUT);

  const entries: SbaSizeStandard[] = [];
  let sheetsProcessed = 0;

  for (const worksheet of workbook.worksheets) {
    sheetsProcessed++;
    let naicsColIdx = -1;
    let titleColIdx = -1;
    let sizeColIdx = -1;
    let headerFound = false;

    worksheet.eachRow((row, rowNumber) => {
      const values = row.values as any[];
      if (!values || values.length < 3) return;

      // Find header row
      if (!headerFound) {
        for (let i = 1; i < values.length; i++) {
          const val = String(values[i] ?? "").toLowerCase().trim();
          if (val.includes("naics") && val.includes("code")) naicsColIdx = i;
          if (val.includes("naics") && val.includes("industry")) titleColIdx = i;
          if (val.includes("size standard") || val.includes("size_standard")) sizeColIdx = i;
        }
        if (naicsColIdx > 0 && sizeColIdx > 0) headerFound = true;
        return;
      }

      // Parse data rows
      const naicsRaw = String(values[naicsColIdx] ?? "").trim();
      const naicsCode = naicsRaw.replace(/[^0-9]/g, "");
      if (!naicsCode || naicsCode.length < 4) return;

      const title = String(values[titleColIdx] ?? "").trim();
      const sizeRaw = String(values[sizeColIdx] ?? "").trim();

      // Parse size standard
      let sizeType: SbaSizeStandard["size_standard_type"] = "other";
      let sizeValue: number | null = null;
      let sizeUnit = sizeRaw;

      const millionMatch = sizeRaw.match(/\$([\d,.]+)\s*(?:million|mil|m)/i);
      const employeeMatch = sizeRaw.match(/([\d,]+)\s*employees/i);

      if (millionMatch) {
        sizeType = "revenue";
        sizeValue = parseFloat(millionMatch[1].replace(/,/g, "")) * 1_000_000;
        sizeUnit = "dollars_annual_revenue";
      } else if (employeeMatch) {
        sizeType = "employees";
        sizeValue = parseInt(employeeMatch[1].replace(/,/g, ""), 10);
        sizeUnit = "employees";
      } else {
        // Try plain number — distinguish revenue (typically shown with $) vs employees
        const plainNum = parseFloat(sizeRaw.replace(/[$,]/g, ""));
        if (Number.isFinite(plainNum) && plainNum > 0) {
          if (sizeRaw.includes("$") || plainNum >= 1_000) {
            // Revenue in millions
            sizeType = "revenue";
            sizeValue = plainNum * 1_000_000;
            sizeUnit = "dollars_annual_revenue";
          } else {
            // Employee count (typically < 1500)
            sizeType = "employees";
            sizeValue = plainNum;
            sizeUnit = "employees";
          }
        }
      }

      entries.push({
        naics_code: naicsCode,
        naics_title: title,
        size_standard: sizeRaw,
        size_standard_type: sizeType,
        size_standard_value: sizeValue,
        size_standard_unit: sizeUnit,
      });
    });
  }

  if (entries.length === 0) {
    console.warn(`WARNING: No entries parsed from ${sheetsProcessed} sheets. Schema may have changed.`);
    console.warn("Check the XLSX structure manually.");
  }

  const output = {
    source_name: "SBA Table of Size Standards",
    source_url: "https://www.sba.gov/document/support-table-size-standards",
    source_vintage: "Effective March 17, 2023",
    ingested_at: new Date().toISOString(),
    row_count: entries.length,
    entries,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${entries.length} SBA size standard entries to ${OUTPUT}`);
}

main().catch(console.error);
