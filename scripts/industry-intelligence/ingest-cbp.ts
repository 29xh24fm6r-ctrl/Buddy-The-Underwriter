/**
 * Ingest Census County Business Patterns (CBP) → static JSON
 *
 * Source: Census CBP 2021 National data
 * URL: https://www2.census.gov/programs-surveys/cbp/datasets/2021/cbp21us.zip
 * Output: data/industry-intelligence/cbp-national.json
 *
 * Extracts: NAICS code, establishments, employment, annual payroll
 * Filters: 6-digit NAICS codes only (industry-level), all legal forms combined
 *
 * Run: npx tsx scripts/industry-intelligence/ingest-cbp.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type CbpEntry = {
  naics: string;
  establishments: number | null;
  employment: number | null;
  annual_payroll_thousands: number | null;
  avg_payroll_per_employee: number | null;
};

const INPUT = resolve("/tmp/cbp21us.txt");
const OUTPUT = resolve(__dirname, "../../data/industry-intelligence/cbp-national.json");

function parseNum(val: string): number | null {
  if (!val || val === "S" || val === "N" || val === "D" || val === "G" || val === "H" || val === "J" || val === "K") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function main() {
  const raw = readFileSync(INPUT, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split(",").map((h) => h.replace(/"/g, ""));

  const naicsIdx = header.indexOf("naics");
  const lfoIdx = header.indexOf("lfo");
  const estIdx = header.indexOf("est");
  const empIdx = header.indexOf("emp");
  const apIdx = header.indexOf("ap");

  if (naicsIdx < 0 || estIdx < 0) {
    throw new Error(`Schema change detected: expected columns naics, est, emp, ap. Got: ${header.join(", ")}`);
  }

  const entries: CbpEntry[] = [];

  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.replace(/"/g, ""));
    const naics = cols[naicsIdx];
    const lfo = cols[lfoIdx];

    // Only 6-digit codes, all legal forms combined (lfo = "-")
    if (!naics || naics.includes("-") || naics.includes("/")) continue;
    if (naics.length !== 6) continue;
    if (lfo !== "-") continue;

    const est = parseNum(cols[estIdx]);
    const emp = parseNum(cols[empIdx]);
    const ap = parseNum(cols[apIdx]);

    entries.push({
      naics,
      establishments: est,
      employment: emp,
      annual_payroll_thousands: ap,
      avg_payroll_per_employee: emp && ap && emp > 0 ? Math.round((ap * 1000) / emp) : null,
    });
  }

  const output = {
    source_name: "Census County Business Patterns",
    source_url: "https://www2.census.gov/programs-surveys/cbp/datasets/2021/cbp21us.zip",
    source_vintage: "2021",
    ingested_at: new Date().toISOString(),
    row_count: entries.length,
    entries,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${entries.length} CBP entries to ${OUTPUT}`);
}

main();
