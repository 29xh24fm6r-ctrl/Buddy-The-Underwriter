/**
 * Ingest Census NAICS Reference File → static JSON
 *
 * Source: Census CBP NAICS descriptions (naics2017.txt format, also covers 2022 codes)
 * URL: https://www2.census.gov/programs-surveys/cbp/technical-documentation/reference/naics-descriptions/naics2017.txt
 * Output: data/industry-intelligence/naics-reference.json
 *
 * Run: npx tsx scripts/industry-intelligence/ingest-naics-reference.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type NaicsEntry = {
  code: string;
  title: string;
  level: "sector" | "subsector" | "industry_group" | "industry" | "national";
  sector_code: string;
  sector_title: string;
};

const INPUT = resolve("/tmp/naics2022.csv");
const OUTPUT = resolve(__dirname, "../../data/industry-intelligence/naics-reference.json");

function parseLevel(code: string): NaicsEntry["level"] {
  const clean = code.replace(/[-/]/g, "");
  if (clean.length <= 2) return "sector";
  if (clean.length === 3) return "subsector";
  if (clean.length === 4) return "industry_group";
  if (clean.length >= 5) return "industry";
  return "national";
}

function cleanCode(raw: string): string {
  return raw.replace(/["-]/g, "").replace(/\//g, "").trim();
}

function main() {
  const raw = readFileSync(INPUT, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  // Build sector map first
  const sectorMap = new Map<string, string>();
  const entries: NaicsEntry[] = [];

  for (const line of lines.slice(1)) {
    // CSV: "NAICS","DESCRIPTION"
    const match = line.match(/"([^"]+)","([^"]+)"/);
    if (!match) continue;
    const [, rawCode, title] = match;
    const code = cleanCode(rawCode);
    if (code.length === 0 || code === "Total for all sectors") continue;

    const level = parseLevel(rawCode);
    if (level === "sector") {
      sectorMap.set(code.slice(0, 2), title);
    }
  }

  // NAICS multi-prefix sectors: 31-33=Manufacturing, 44-45=Retail, 48-49=Transportation
  const MULTI_PREFIX_SECTORS: Record<string, string> = {};
  for (const [prefix, title] of sectorMap.entries()) {
    if (prefix === "31") { MULTI_PREFIX_SECTORS["32"] = title; MULTI_PREFIX_SECTORS["33"] = title; }
    if (prefix === "44") { MULTI_PREFIX_SECTORS["45"] = title; }
    if (prefix === "48") { MULTI_PREFIX_SECTORS["49"] = title; }
  }

  // Second pass: build entries with sector context
  for (const line of lines.slice(1)) {
    const match = line.match(/"([^"]+)","([^"]+)"/);
    if (!match) continue;
    const [, rawCode, title] = match;
    const code = cleanCode(rawCode);
    if (code.length === 0) continue;

    const level = parseLevel(rawCode);
    const sectorPrefix = code.slice(0, 2);
    const sectorTitle = sectorMap.get(sectorPrefix) ?? MULTI_PREFIX_SECTORS[sectorPrefix] ?? "Unknown";

    entries.push({
      code,
      title,
      level,
      sector_code: sectorPrefix,
      sector_title: sectorTitle,
    });
  }

  const output = {
    source_name: "Census NAICS Reference",
    source_url: "https://www2.census.gov/programs-surveys/cbp/technical-documentation/reference/naics-descriptions/naics2017.txt",
    source_vintage: "2022",
    ingested_at: new Date().toISOString(),
    row_count: entries.length,
    entries,
  };

  writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`Wrote ${entries.length} NAICS entries to ${OUTPUT}`);
}

main();
