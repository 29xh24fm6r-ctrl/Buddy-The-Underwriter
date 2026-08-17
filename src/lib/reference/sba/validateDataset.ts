/**
 * Integrity validation for the generated SBA size-standard artifact.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1.
 *
 * One pure validator, three consumers:
 *   - the importer (refuses to write an artifact that fails)
 *   - the runtime loader (refuses to serve a corrupt artifact; the caller
 *     turns that into a `data_error` state, never a borrower denial)
 *   - the CI guard (fails the build)
 *
 * Having a single implementation is the point: a guard that checks
 * something different from what the loader checks is a guard that passes
 * while production is broken.
 */

import type {
  SbaSizeStandardCounts,
  SbaSizeStandardDataset,
  SbaSizeStandardRecord,
} from "./types";
import { recordKey } from "./parseSizeStandardRow";

/**
 * Coverage floor for a complete import.
 *
 * VERIFIED against the official workbook (SHA-256 dadfaf90…456f, effective
 * 2023-03-17): the table carries exactly **978 unique six-digit NAICS
 * codes** plus 18 exception rows, spanning 23 sectors (11 through 81).
 *
 * NAICS 2022 defines 1,012 six-digit U.S. industries, so 34 are absent —
 * SBA does not assign size standards to Sector 92 (Public Administration)
 * or a handful of similar non-commercial industries. That gap is a property
 * of the authoritative source, not a defect in the import.
 *
 * An earlier revision set this to 1,000 as a planning estimate before the
 * real file was available. It is corrected here to sit just below the
 * verified figure: low enough not to fail a legitimate SBA revision that
 * retires a few industries, high enough that any partial import — above all
 * a return to the 52-entry placeholder — still fails loudly. The exact
 * count is additionally frozen in the manifest and enforced by the
 * counts_mismatch check, so this floor is a backstop, not the real test.
 */
export const MIN_UNIQUE_NAICS = 950;

/**
 * `other` means "the importer could not classify this row's measure".
 * A handful is tolerable; a flood means the parse broke. The legacy
 * artifact was 1,039 of 2,061 rows (50.4%) unclassified while still
 * reporting success — hence a hard ceiling rather than a warning.
 */
export const MAX_OTHER_ROW_RATIO = 0.02;

export type ValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export function computeCounts(
  records: readonly SbaSizeStandardRecord[],
): SbaSizeStandardCounts {
  const unique = new Set(records.map((r) => r.naics));
  return {
    totalRows: records.length,
    uniqueNaics: unique.size,
    baseRows: records.filter((r) => r.exceptionLabel == null).length,
    exceptionRows: records.filter((r) => r.exceptionLabel != null).length,
    footnotedRows: records.filter((r) => r.footnoteRefs.length > 0).length,
    receiptsRows: records.filter((r) => r.measure === "annual_receipts").length,
    employeeRows: records.filter((r) => r.measure === "employees").length,
    assetsRows: records.filter((r) => r.measure === "assets").length,
    otherRows: records.filter((r) => r.measure === "other").length,
  };
}

/**
 * Validates a dataset. Returns every issue found rather than throwing on
 * the first — a partial report during a data migration is worse than a
 * complete one.
 */
export function validateDataset(
  dataset: SbaSizeStandardDataset,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) =>
    issues.push({ severity: "error", code, message });
  const warn = (code: string, message: string) =>
    issues.push({ severity: "warning", code, message });

  // ─── Provenance ────────────────────────────────────────────────────────
  if (!dataset.version) err("missing_version", "dataset.version is empty");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.effectiveDate)) {
    err(
      "bad_effective_date",
      `effectiveDate must be an ISO date, got "${dataset.effectiveDate}"`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(dataset.sourceSha256)) {
    err(
      "bad_source_hash",
      "sourceSha256 must be a 64-character hex SHA-256 of the downloaded source",
    );
  }
  if (!dataset.sourceUrl.startsWith("https://")) {
    err("bad_source_url", "sourceUrl must be an https URL to the official source");
  }

  // ─── Coverage ──────────────────────────────────────────────────────────
  const counts = computeCounts(dataset.records);

  if (counts.uniqueNaics < MIN_UNIQUE_NAICS) {
    err(
      "insufficient_coverage",
      `only ${counts.uniqueNaics} unique 6-digit NAICS codes; expected at least ` +
        `${MIN_UNIQUE_NAICS}. This looks like a partial import — refusing to ship ` +
        `a placeholder-sized table.`,
    );
  }

  if (counts.totalRows > 0) {
    const otherRatio = counts.otherRows / counts.totalRows;
    if (otherRatio > MAX_OTHER_ROW_RATIO) {
      err(
        "excessive_unclassified",
        `${counts.otherRows}/${counts.totalRows} rows ` +
          `(${(otherRatio * 100).toFixed(1)}%) have measure "other"; ceiling is ` +
          `${(MAX_OTHER_ROW_RATIO * 100).toFixed(1)}%. The measure-type parse is broken.`,
      );
    }
  }

  if (counts.exceptionRows === 0) {
    err(
      "no_exception_rows",
      "zero exception rows found — §121.201 publishes exception rows " +
        "(e.g. 115310 Exception 1); zero means they were flattened or dropped",
    );
  }

  if (counts.receiptsRows === 0 || counts.employeeRows === 0) {
    err(
      "missing_measure_type",
      `expected both receipts-based and employee-based rows; got ` +
        `${counts.receiptsRows} receipts / ${counts.employeeRows} employees`,
    );
  }

  // ─── Declared counts must match reality ────────────────────────────────
  for (const key of Object.keys(counts) as Array<keyof SbaSizeStandardCounts>) {
    if (dataset.counts[key] !== counts[key]) {
      err(
        "counts_mismatch",
        `manifest counts.${key}=${dataset.counts[key]} but records contain ${counts[key]}`,
      );
    }
  }

  // ─── Per-record integrity ──────────────────────────────────────────────
  const seen = new Map<string, number>();
  dataset.records.forEach((record, index) => {
    const where = `record[${index}] (${record.naics}${
      record.exceptionLabel ? ` ${record.exceptionLabel}` : ""
    })`;

    if (!/^\d{6}$/.test(record.naics)) {
      err("bad_naics", `${where}: NAICS is not a 6-digit code`);
    }

    const key = recordKey(record);
    const previous = seen.get(key);
    if (previous != null) {
      err(
        "duplicate_record",
        `${where}: duplicate of record[${previous}] — the importer double-read ` +
          `a row (the legacy importer looped every worksheet and double-counted)`,
      );
    }
    seen.set(key, index);

    const populated = [
      record.receiptsMillionsUsd,
      record.employees,
      record.assetsMillionsUsd,
    ].filter((v) => v != null).length;

    if (record.measure === "other") {
      if (populated > 0) {
        err("other_with_value", `${where}: measure "other" but a threshold is set`);
      }
    } else if (populated !== 1) {
      err(
        "threshold_cardinality",
        `${where}: measure "${record.measure}" must have exactly one threshold, found ${populated}`,
      );
    }

    if (record.measure === "annual_receipts" && record.receiptsMillionsUsd == null) {
      err("missing_receipts", `${where}: receipts measure with no receipts value`);
    }
    if (record.measure === "employees" && record.employees == null) {
      err("missing_employees", `${where}: employee measure with no employee value`);
    }
    if (record.measure === "assets" && record.assetsMillionsUsd == null) {
      err("missing_assets", `${where}: assets measure with no assets value`);
    }

    for (const [field, value] of [
      ["receiptsMillionsUsd", record.receiptsMillionsUsd],
      ["employees", record.employees],
      ["assetsMillionsUsd", record.assetsMillionsUsd],
    ] as const) {
      if (value != null && (!Number.isFinite(value) || value <= 0)) {
        err("bad_threshold", `${where}: ${field} must be a positive finite number`);
      }
    }

    if (record.measure === "employees" && !Number.isInteger(record.employees)) {
      err("fractional_employees", `${where}: employee standard must be an integer`);
    }

    if (!record.title.trim()) {
      warn("missing_title", `${where}: empty industry title`);
    }

    for (const ref of record.footnoteRefs) {
      if (!dataset.footnotes[ref]) {
        warn(
          "unknown_footnote",
          `${where}: references footnote ${ref}, which is not in the footnote map`,
        );
      }
    }
  });

  return issues;
}

export function assertDatasetValid(dataset: SbaSizeStandardDataset): void {
  const issues = validateDataset(dataset);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `SBA size-standard dataset failed validation (${errors.length} error(s)):\n` +
        errors.map((e) => `  [${e.code}] ${e.message}`).join("\n"),
    );
  }
}
