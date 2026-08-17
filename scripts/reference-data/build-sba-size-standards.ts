/**
 * Build the authoritative SBA size-standard artifact.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1 (revised source decision).
 *
 *   SBA JSON (base)
 *     -> deterministic normalization
 *     -> cross-check vs official XLSX
 *     -> cross-check vs 13 CFR §121.201 (legal verification)
 *     -> validation
 *     -> versioned artifact + manifest/hash
 *
 * Runs offline only. Borrower eligibility must never depend on an SBA or
 * eCFR host being reachable at request time.
 *
 * ─── Source status as of 2026-08-17 (RE-VERIFY BEFORE EACH RUN) ─────────
 * Dataset landing page (last modified 2026-04-22):
 *   https://data.sba.gov/dataset/small-business-size-standards
 *   Identifier: SBA-GCBD-2014-08-001
 *
 * The JSON resource is advertised at two URLs, BOTH of which returned HTTP
 * 404 when checked on 2026-08-17:
 *   - https://www.sba.gov/sites/default/files/data/naics.json   (landing page)
 *   - https://api.sba.gov/naics/naics.json                      (CKAN record)
 *
 * The CKAN record for that resource reports "Data last updated July 16,
 * 2020", and the published Swagger definition describes the /naics response
 * in terms of id, description, sectorId, sectorDescription, subsectorId,
 * subsectorDescription, parent — CLASSIFICATION fields, with no size-
 * standard field documented. It is therefore NOT established that the JSON
 * carries thresholds or §121.201 exception rows at all.
 *
 * Consequence, deliberately encoded below: the JSON path runs a schema
 * PROBE first and refuses to emit an artifact if thresholds are absent. If
 * the JSON proves classification-only it becomes a hierarchy source, and
 * the size standards come from the XLSX — the file SBA actually publishes
 * for download and keeps current.
 *
 * XLSX (current, URL confirmed live on the landing page):
 *   https://data.sba.gov/sites/default/files/distribution/
 *     SBA-GCBD-2014-08-001/sba-table-of-size-standards_effective-march-17-2023_v0.xlsx
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *   # 1. inspect the JSON schema without writing anything — DO THIS FIRST
 *   pnpm reference:build:sba -- --source-file ./naics.json --probe-only
 *
 *   # 2. preferred: JSON base + XLSX cross-check
 *   pnpm reference:build:sba -- \
 *     --source-file ./naics.json \
 *     --xlsx-source-file ./sba-table-of-size-standards_effective-march-17-2023_v0.xlsx
 *
 *   # 3. XLSX as base (use if the JSON proves classification-only)
 *   pnpm reference:build:sba -- --xlsx-source-file ./table.xlsx --base xlsx
 *
 *   # 4. add the legal cross-check
 *   pnpm reference:build:sba -- ... --ecfr-source-file ./121.201.xml
 *
 * Sources may also be fetched directly with --fetch-json / --fetch-xlsx /
 * --fetch-ecfr where the environment permits .gov egress.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import ExcelJS from "exceljs";

import {
  parseSizeStandardRow,
  recordKey,
  type RawSizeStandardRow,
} from "../../src/lib/reference/sba/parseSizeStandardRow";
import {
  normalizeSbaJson,
  describeJsonSchema,
  formatSchemaReport,
  SbaJsonSchemaError,
} from "../../src/lib/reference/sba/parseSbaJson";
import {
  selectTableSheet,
  extractXlsxRows,
  type SheetLike,
} from "../../src/lib/reference/sba/parseXlsxSheet";
import {
  crossCheckRecords,
  formatCrossCheck,
} from "../../src/lib/reference/sba/crossCheck";
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

const JSON_URLS = [
  "https://www.sba.gov/sites/default/files/data/naics.json",
  "https://api.sba.gov/naics/naics.json",
];
const XLSX_URL =
  "https://data.sba.gov/sites/default/files/distribution/SBA-GCBD-2014-08-001/" +
  "sba-table-of-size-standards_effective-march-17-2023_v0.xlsx";
const ECFR_URL_BASE =
  "https://www.ecfr.gov/api/versioner/v1/full/{date}/title-13.xml?section=121.201";
const DATASET_PAGE = "https://data.sba.gov/dataset/small-business-size-standards";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ─── eCFR extraction (retained from the original Phase 1 commit as the
//     legal cross-check; unchanged and still covered by extractRows tests)

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

function rowsToRecords(rows: RawSizeStandardRow[]): {
  records: SbaSizeStandardRecord[];
  headings: number;
  malformed: Array<{ reason: string; row: RawSizeStandardRow }>;
} {
  const records: SbaSizeStandardRecord[] = [];
  const malformed: Array<{ reason: string; row: RawSizeStandardRow }> = [];
  let headings = 0;

  for (const row of rows) {
    const result = parseSizeStandardRow(row);
    if (result.kind === "record") records.push(result.record);
    else if (result.kind === "heading") headings += 1;
    else malformed.push({ reason: result.reason, row: result.row });
  }

  return { records, headings, malformed };
}

// ─── Source loading ──────────────────────────────────────────────────────

async function loadBytes(opts: {
  fileArg: string | null;
  fetchUrls: string[];
  shouldFetch: boolean;
  label: string;
}): Promise<{ bytes: Buffer; url: string } | null> {
  if (opts.fileArg) {
    const path = resolve(process.cwd(), opts.fileArg);
    console.log(`[${opts.label}] reading from disk: ${path}`);
    return { bytes: readFileSync(path), url: opts.fetchUrls[0] ?? DATASET_PAGE };
  }

  if (!opts.shouldFetch) return null;

  const errors: string[] = [];
  for (const url of opts.fetchUrls) {
    console.log(`[${opts.label}] fetching ${url}`);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "buddy-the-underwriter reference-data importer" },
      });
      if (response.ok) {
        return { bytes: Buffer.from(await response.arrayBuffer()), url };
      }
      errors.push(`${url} -> ${response.status} ${response.statusText}`);
    } catch (error) {
      errors.push(`${url} -> ${(error as Error).message}`);
    }
  }

  throw new Error(
    `[${opts.label}] all source URLs failed:\n  ${errors.join("\n  ")}\n` +
      `Download the file manually from ${DATASET_PAGE} and re-run with the ` +
      `corresponding --*-source-file flag.`,
  );
}

async function readXlsxSheets(bytes: Buffer): Promise<SheetLike[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

  return workbook.worksheets.map((worksheet) => {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      // exceljs uses 1-based indexing with a leading hole. Normalize to
      // 0-based WITHOUT collapsing empty cells — collapsing shifts columns
      // and silently moves an employee count into the receipts field.
      const cells: string[] = [];
      for (let i = 1; i < values.length; i++) {
        const value = values[i];
        cells.push(
          value == null ? "" : String((value as { text?: string })?.text ?? value),
        );
      }
      rows.push(cells);
    });
    return { name: worksheet.name, rows };
  });
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const base = (arg("base") ?? "json").toLowerCase();
  if (base !== "json" && base !== "xlsx") {
    throw new Error(`--base must be "json" or "xlsx", got "${base}"`);
  }

  // ── JSON (preferred base source) ──────────────────────────────────────
  let jsonRecords: SbaSizeStandardRecord[] | null = null;
  let jsonSha: string | null = null;
  let jsonUrl: string | null = null;
  let jsonRejected = 0;

  const jsonSource = await loadBytes({
    fileArg: arg("source-file") ?? arg("json-source-file"),
    fetchUrls: JSON_URLS,
    shouldFetch: flag("fetch-json"),
    label: "json",
  });

  if (jsonSource) {
    jsonSha = sha256(jsonSource.bytes);
    jsonUrl = jsonSource.url;
    const payload = JSON.parse(jsonSource.bytes.toString("utf8"));

    console.log("\n── SBA JSON schema probe ──");
    console.log(formatSchemaReport(describeJsonSchema(payload)));

    if (flag("probe-only")) {
      console.log(
        "\n--probe-only: stopping before normalization. Send the report above back " +
          "for review before generating an artifact.",
      );
      return;
    }

    try {
      const normalized = normalizeSbaJson(payload);
      jsonRecords = normalized.records;
      jsonRejected = normalized.rejected.length;
      console.log(
        `\n[json] normalized ${jsonRecords.length} records, ${jsonRejected} rejected`,
      );
      for (const entry of normalized.rejected.slice(0, 20)) {
        console.log(`  rejected: ${entry.reason}`);
      }
    } catch (error) {
      if (error instanceof SbaJsonSchemaError) {
        console.error(`\n[json] SCHEMA MISMATCH — ${error.message}`);
        if (base === "json") {
          console.error(
            "\nRefusing to continue with JSON as the base source. If the official " +
              "XLSX should supply the size standards, re-run with --base xlsx, and " +
              "report the schema probe above for review.",
          );
          process.exit(1);
        }
        console.error("[json] continuing with XLSX as base per --base xlsx");
      } else {
        throw error;
      }
    }
  } else if (base === "json") {
    throw new Error(
      "No JSON source provided. Pass --source-file <naics.json> or --fetch-json. " +
        `Note: as of 2026-08-17 both advertised JSON URLs returned 404 ` +
        `(${JSON_URLS.join(", ")}).`,
    );
  }

  // ── XLSX (cross-check, or base) ───────────────────────────────────────
  let xlsxRecords: SbaSizeStandardRecord[] | null = null;
  let xlsxSha: string | null = null;
  let xlsxMalformed = 0;
let xlsxMisaligned = 0;

  const xlsxSource = await loadBytes({
    fileArg: arg("xlsx-source-file"),
    fetchUrls: [XLSX_URL],
    shouldFetch: flag("fetch-xlsx"),
    label: "xlsx",
  });

  if (xlsxSource) {
    xlsxSha = sha256(xlsxSource.bytes);
    const sheets = await readXlsxSheets(xlsxSource.bytes);
    console.log(`[xlsx] worksheets: ${sheets.map((s) => s.name).join(", ")}`);
    const { sheet, layout } = selectTableSheet(sheets);
    console.log(
      `[xlsx] using worksheet "${sheet.name}" (header row ${layout.headerRowIndex + 1})`,
    );
    const parsed = rowsToRecords(extractXlsxRows(sheet, layout));
    xlsxRecords = parsed.records;
    xlsxMalformed = parsed.malformed.length;
    console.log(
      `[xlsx] ${xlsxRecords.length} records, ${parsed.headings} headings, ` +
        `${xlsxMalformed} unparsed`,
    );
    for (const entry of parsed.malformed.slice(0, 20)) {
      console.log(
        `  unparsed: ${entry.reason} :: ${JSON.stringify(entry.row.naicsCell)}`,
      );
    }
    xlsxMisaligned = parsed.malformed.filter((m) =>
      /misaligned/i.test(m.reason),
    ).length;
  }

  // ── eCFR (legal cross-check) ──────────────────────────────────────────
  let ecfrRecords: SbaSizeStandardRecord[] | null = null;
  let footnotes: Record<string, string> = {};
  let ecfrSha: string | null = null;

  const asOf = arg("as-of") ?? new Date().toISOString().slice(0, 10);
  const ecfrSource = await loadBytes({
    fileArg: arg("ecfr-source-file"),
    fetchUrls: [ECFR_URL_BASE.replace("{date}", asOf)],
    shouldFetch: flag("fetch-ecfr"),
    label: "ecfr",
  });

  if (ecfrSource) {
    ecfrSha = sha256(ecfrSource.bytes);
    const markup = ecfrSource.bytes.toString("utf8");
    const parsed = rowsToRecords(extractRows(markup));
    ecfrRecords = parsed.records;
    footnotes = extractFootnotes(markup);
    console.log(
      `[ecfr] ${ecfrRecords.length} records, ${Object.keys(footnotes).length} footnotes`,
    );
  }

  // ── Choose the base record set ────────────────────────────────────────
  const baseRecords = base === "json" ? jsonRecords : xlsxRecords;
  if (!baseRecords || baseRecords.length === 0) {
    throw new Error(`No records produced from the ${base} base source.`);
  }

  // ── Cross-checks: STOP on material disagreement ───────────────────────
  const crossChecks = [];
  if (base === "json" && xlsxRecords) {
    crossChecks.push(
      crossCheckRecords({
        base: baseRecords,
        reference: xlsxRecords,
        baseLabel: "SBA JSON",
        referenceLabel: "SBA XLSX",
      }),
    );
  }
  if (ecfrRecords) {
    crossChecks.push(
      crossCheckRecords({
        base: baseRecords,
        reference: ecfrRecords,
        baseLabel: base === "json" ? "SBA JSON" : "SBA XLSX",
        referenceLabel: "13 CFR 121.201",
      }),
    );
  }

  let materialTotal = 0;
  for (const result of crossChecks) {
    console.log(`\n── cross-check ──\n${formatCrossCheck(result)}`);
    materialTotal += result.materialCount;
  }

  if (materialTotal > 0 && !flag("allow-discrepancies")) {
    console.error(
      `\nSTOP: ${materialTotal} material discrepancy/discrepancies between official ` +
        `sources. Buddy will not guess which threshold to use. Report the ` +
        `discrepancies above for human review before shipping an artifact.`,
    );
    process.exit(2);
  }

  // ── Assemble, validate, write ─────────────────────────────────────────
  const records = [...baseRecords].sort((a, b) =>
    recordKey(a).localeCompare(recordKey(b)),
  );

  // Duplicate compound keys — reported explicitly (the validator also
  // errors on these; counting them here makes the figure reportable).
  const keyCounts = new Map<string, number>();
  for (const record of records) {
    const key = recordKey(record);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const duplicateKeys = Array.from(keyCounts.entries()).filter(([, n]) => n > 1);
  for (const [key, n] of duplicateKeys.slice(0, 20)) {
    console.error(`  duplicate compound key: ${key} x${n}`);
  }

  // Optional Census 2022 cross-check: which SBA codes are not present in
  // the Census universe (and vice versa). Classification data only — this
  // never supplies or alters a threshold.
  let censusUnmatched: string[] = [];
  let censusChecked = false;
  const censusFile = arg("census-file");
  if (censusFile) {
    censusChecked = true;
    const censusRaw = readFileSync(resolve(process.cwd(), censusFile), "utf8");
    const censusCodes = new Set(
      (censusRaw.match(/\b\d{6}\b/g) ?? []).map((c) => c),
    );
    censusUnmatched = Array.from(
      new Set(records.map((r) => r.naics).filter((c) => !censusCodes.has(c))),
    ).sort();
    console.log(
      `[census] ${censusCodes.size} codes in Census file; ` +
        `${censusUnmatched.length} SBA codes unmatched`,
    );
    for (const code of censusUnmatched.slice(0, 20)) {
      console.log(`  unmatched: ${code}`);
    }
  }

  const dataset: SbaSizeStandardDataset = {
    version: arg("version") ?? "2023-03",
    effectiveDate: arg("effective-date") ?? "2023-03-17",
    sourceName:
      base === "json"
        ? "SBA Small Business Size Standards - NAICS Data (JSON)"
        : "SBA Table of Small Business Size Standards (XLSX)",
    sourceUrl: base === "json" ? (jsonUrl ?? DATASET_PAGE) : XLSX_URL,
    sourceSha256: (base === "json" ? jsonSha : xlsxSha) ?? "",
    importedAt: new Date().toISOString(),
    footnotes,
    counts: computeCounts(records),
    records,
  };

  const issues = validateDataset(dataset);
  const errors = issues.filter((i) => i.severity === "error");
  for (const warning of issues.filter((i) => i.severity === "warning").slice(0, 25)) {
    console.warn(`  warning [${warning.code}] ${warning.message}`);
  }
  if (errors.length > 0) {
    console.error(
      `\nRefusing to write artifact — ${errors.length} validation error(s):`,
    );
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

  console.log("\n── Phase 1 report figures ──");
  console.log(`  base source          ${dataset.sourceName}`);
  console.log(`  source URL           ${dataset.sourceUrl}`);
  console.log(`  effective date       ${dataset.effectiveDate}`);
  console.log(`  JSON SHA-256         ${jsonSha ?? "(not supplied)"}`);
  console.log(`  XLSX SHA-256         ${xlsxSha ?? "(not supplied)"}`);
  console.log(`  eCFR SHA-256         ${ecfrSha ?? "(not supplied)"}`);
  console.log(`  records SHA-256      ${manifest.recordsSha256}`);
  console.log(`  total rows           ${dataset.counts.totalRows}`);
  console.log(`  unique 6-digit       ${dataset.counts.uniqueNaics}`);
  console.log(`  base rows            ${dataset.counts.baseRows}`);
  console.log(`  exception rows       ${dataset.counts.exceptionRows}`);
  console.log(`  footnoted rows       ${dataset.counts.footnotedRows}`);
  console.log(`  receipts standards   ${dataset.counts.receiptsRows}`);
  console.log(`  employee standards   ${dataset.counts.employeeRows}`);
  console.log(`  asset standards      ${dataset.counts.assetsRows}`);
  console.log(`  other/unclassified   ${dataset.counts.otherRows}`);
  console.log(`  json rejected        ${jsonRejected}`);
  console.log(`  xlsx unparsed        ${xlsxMalformed}`);
  console.log(`  misaligned rows      ${xlsxMisaligned}`);
  console.log(`  duplicate keys       ${duplicateKeys.length}`);
  console.log(
    `  census unmatched     ${censusChecked ? censusUnmatched.length : "(not checked)"}`,
  );
  console.log(`  material discrepanc. ${materialTotal}`);
  console.log(`\nWrote ${OUT_DATASET}\nWrote ${OUT_MANIFEST}`);
}

// Only run when invoked directly, so the extract helpers can be imported by
// unit tests without triggering a network fetch.
if (process.argv[1] && /build-sba-size-standards/.test(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
