/**
 * Build the authoritative SBA size-standard artifact.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1.
 *
 *   official source -> deterministic parse -> validate -> artifact + manifest
 *
 * This script is the ONLY sanctioned way size-standard data enters Buddy.
 * It runs offline (operator or CI job), never in a request path: borrower
 * eligibility must never depend on an SBA host being reachable.
 *
 * ─── Source ─────────────────────────────────────────────────────────────
 * Primary: 13 CFR §121.201 via the eCFR versioner API. §121.201 is the
 * legally operative text; the SBA .xlsx is a convenience rendering of it.
 * The API is versioned and point-in-time addressable, which is what makes
 * this reproducible: the same --as-of date always yields the same bytes.
 *
 * Cross-check: the SBA Table of Size Standards .xlsx
 * (https://www.sba.gov/document/support-table-size-standards). Use
 * --xlsx <path> to assert the two agree before writing. Disagreement is a
 * hard stop, not a warning.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *   pnpm reference:build:sba
 *   pnpm reference:build:sba -- --as-of 2026-08-17
 *   pnpm reference:build:sba -- --source-file ./121.201.xml   # air-gapped
 *   pnpm reference:build:sba -- --xlsx ./TableOfSizeStandards.xlsx
 *
 * --source-file exists because some networks (including CI sandboxes)
 * cannot reach .gov hosts. Downloading by hand and feeding the exact bytes
 * in is equivalent: the SHA-256 of those bytes is recorded either way, so
 * provenance survives.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  parseSizeStandardRow,
  type RawSizeStandardRow,
} from "../../src/lib/reference/sba/parseSizeStandardRow";
import {
  computeCounts,
  validateDataset,
} from "../../src/lib/reference/sba/validateDataset";
import type {
  SbaSizeStandardDataset,
  SbaSizeStandardManifest,
  SbaSizeStandardRecord,
} from "../../src/lib/reference/sba/types";

const OUT_DIR = resolve(__dirname, "../../data/reference");
const OUT_DATASET = resolve(OUT_DIR, "sba-size-standards.json");
const OUT_MANIFEST = resolve(OUT_DIR, "sba-size-standards.manifest.json");

const SOURCE_NAME = "13 CFR 121.201 (eCFR versioner API)";
const SOURCE_PAGE =
  "https://www.ecfr.gov/current/title-13/chapter-I/part-121/subpart-A/subject-group-ECFRf12a11421b08a31/section-121.201";

function ecfrUrl(asOf: string): string {
  return `https://www.ecfr.gov/api/versioner/v1/full/${asOf}/title-13.xml?section=121.201`;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Extracts table rows from the §121.201 XML/HTML payload.
 *
 * Kept intentionally dumb: pull cell text in document order, hand each row
 * to the tested pure parser. All interpretation — measure type, exceptions,
 * footnotes — lives in parseSizeStandardRow.ts under unit test.
 */
export function extractRows(markup: string): RawSizeStandardRow[] {
  const rows: RawSizeStandardRow[] = [];
  const rowMatches = markup.match(/<ROW\b[\s\S]*?<\/ROW>|<tr\b[\s\S]*?<\/tr>/gi) ?? [];

  for (const rowMarkup of rowMatches) {
    // Self-closing cells (<ENT/>, <td/>) MUST be matched. They represent
    // empty columns, and dropping them shifts every later cell one column
    // left — turning an employee count into a receipts figure. This is the
    // same class of defect that made the legacy importer record 1,250
    // employees as $1.25B of revenue, so it is covered by a test.
    const cells = (
      rowMarkup.match(
        /<ENT\b[^>]*\/>|<ENT\b[\s\S]*?<\/ENT>|<t[dh]\b[^>]*\/>|<t[dh]\b[\s\S]*?<\/t[dh]>/gi,
      ) ?? []
    ).map((cell) =>
      cell
        .replace(/<[^>]+>/g, " ")
        .replace(/&#8212;|&mdash;/g, "—")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );

    if (cells.length === 0) continue;

    rows.push({
      naicsCell: cells[0] ?? "",
      titleCell: cells[1] ?? "",
      receiptsCell: cells[2] ?? "",
      employeesCell: cells[3] ?? "",
    });
  }

  return rows;
}

/**
 * Footnotes are published beneath the table. They are captured verbatim so
 * exception rows can cite them; if extraction yields none, that is an error
 * (§121.201 always carries footnotes) surfaced by the validator's
 * unknown_footnote warnings plus this explicit check.
 */
export function extractFootnotes(markup: string): Record<string, string> {
  const footnotes: Record<string, string> = {};
  const text = markup
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");

  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(\d{1,2})\s+([A-Z].{20,})$/);
    if (match) footnotes[match[1]] = match[2].trim();
  }

  return footnotes;
}

async function loadSource(): Promise<{ bytes: Buffer; url: string }> {
  const sourceFile = arg("source-file");
  if (sourceFile) {
    const path = resolve(process.cwd(), sourceFile);
    console.log(`Reading source from disk: ${path}`);
    return { bytes: readFileSync(path), url: SOURCE_PAGE };
  }

  const asOf = arg("as-of") ?? new Date().toISOString().slice(0, 10);
  const url = ecfrUrl(asOf);
  console.log(`Fetching ${url}`);

  const response = await fetch(url, {
    headers: { "User-Agent": "buddy-the-underwriter reference-data importer" },
  });
  if (!response.ok) {
    throw new Error(
      `Source fetch failed: ${response.status} ${response.statusText}. ` +
        `If this environment cannot reach .gov hosts, download §121.201 manually ` +
        `and re-run with --source-file <path>.`,
    );
  }
  return { bytes: Buffer.from(await response.arrayBuffer()), url };
}

async function main(): Promise<void> {
  const { bytes, url } = await loadSource();
  const sourceSha256 = sha256(bytes);
  const markup = bytes.toString("utf8");

  console.log(`Source SHA-256: ${sourceSha256}`);

  const rawRows = extractRows(markup);
  console.log(`Extracted ${rawRows.length} candidate rows`);

  const records: SbaSizeStandardRecord[] = [];
  const headings: string[] = [];
  const malformed: Array<{ reason: string; row: RawSizeStandardRow }> = [];

  for (const row of rawRows) {
    const result = parseSizeStandardRow(row);
    if (result.kind === "record") records.push(result.record);
    else if (result.kind === "heading") headings.push(result.text);
    else malformed.push({ reason: result.reason, row: result.row });
  }

  // Malformed rows are reported in full, never dropped quietly. Rows that
  // are simply not table content (page furniture, the footnote block) parse
  // as malformed too, so this list is reviewed by a human on every import
  // rather than gated on a count.
  console.log(
    `Parsed: ${records.length} records, ${headings.length} headings, ` +
      `${malformed.length} unparsed rows`,
  );
  for (const entry of malformed.slice(0, 50)) {
    console.log(`  unparsed: ${entry.reason} :: ${JSON.stringify(entry.row.naicsCell)}`);
  }
  if (malformed.length > 50) {
    console.log(`  … ${malformed.length - 50} more`);
  }

  const footnotes = extractFootnotes(markup);
  console.log(`Footnotes captured: ${Object.keys(footnotes).length}`);

  const effectiveDate = arg("effective-date") ?? "2023-03-17";
  const version = arg("version") ?? "2023-03";

  const dataset: SbaSizeStandardDataset = {
    version,
    effectiveDate,
    sourceName: SOURCE_NAME,
    sourceUrl: url,
    sourceSha256,
    importedAt: new Date().toISOString(),
    footnotes,
    counts: computeCounts(records),
    records,
  };

  const issues = validateDataset(dataset);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  for (const warning of warnings.slice(0, 25)) {
    console.warn(`  warning [${warning.code}] ${warning.message}`);
  }

  if (errors.length > 0) {
    console.error(`\nRefusing to write artifact — ${errors.length} validation error(s):`);
    for (const error of errors.slice(0, 40)) {
      console.error(`  [${error.code}] ${error.message}`);
    }
    process.exit(1);
  }

  const manifest: SbaSizeStandardManifest = {
    version: dataset.version,
    effectiveDate: dataset.effectiveDate,
    sourceName: dataset.sourceName,
    sourceUrl: dataset.sourceUrl,
    sourceSha256: dataset.sourceSha256,
    importedAt: dataset.importedAt,
    footnotes: dataset.footnotes,
    counts: dataset.counts,
    recordsSha256: sha256(JSON.stringify(dataset.records)),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_DATASET, `${JSON.stringify(dataset, null, 2)}\n`);
  writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nWrote ${OUT_DATASET}`);
  console.log(`Wrote ${OUT_MANIFEST}`);
  console.log("\n── Phase 1 report figures ──");
  console.log(`  effective date      ${dataset.effectiveDate}`);
  console.log(`  source SHA-256      ${dataset.sourceSha256}`);
  console.log(`  records SHA-256     ${manifest.recordsSha256}`);
  console.log(`  total rows          ${dataset.counts.totalRows}`);
  console.log(`  unique 6-digit      ${dataset.counts.uniqueNaics}`);
  console.log(`  exception rows      ${dataset.counts.exceptionRows}`);
  console.log(`  receipts standards  ${dataset.counts.receiptsRows}`);
  console.log(`  employee standards  ${dataset.counts.employeeRows}`);
  console.log(`  asset standards     ${dataset.counts.assetsRows}`);
  console.log(`  other/unclassified  ${dataset.counts.otherRows}`);
  console.log(`  unparsed rows       ${malformed.length}`);
}

// Only run when invoked directly, so extractRows/extractFootnotes can be
// imported by unit tests without triggering a network fetch.
if (process.argv[1] && /build-sba-size-standards/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
