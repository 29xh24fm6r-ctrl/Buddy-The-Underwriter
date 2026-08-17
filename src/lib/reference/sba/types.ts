/**
 * SBA size-standard reference data — canonical types.
 *
 * PHASE 1 (SPEC-SBA-SIZE-STANDARDS-REFERENCE-1). This module defines the
 * shape of the *authoritative* SBA size-standard dataset. It intentionally
 * contains NO thresholds and NO NAICS data: the data lives in a generated,
 * versioned artifact under data/reference/, produced by
 * scripts/reference-data/build-sba-size-standards.ts from the official
 * source.
 *
 * ─── Source of truth ────────────────────────────────────────────────────
 * 13 CFR §121.201 — "What size standards has SBA identified by North
 * American Industry Classification System codes?"
 *
 * §121.201's own preamble states the operative rule this file encodes:
 *   "The size standards themselves are expressed either in number of
 *    employees or annual receipts in millions of dollars, unless otherwise
 *    specified. The number of employees or annual receipts indicates the
 *    MAXIMUM allowed for a concern AND ITS AFFILIATES to be considered
 *    small."
 *
 * Two consequences are baked into these types:
 *   1. `receiptsMillionsUsd` is stored exactly as published (millions), not
 *      pre-multiplied to dollars. Pre-multiplying in the importer is how
 *      the legacy industry-intelligence artifact turned 1,250 EMPLOYEES
 *      into "$1,250,000,000 of revenue" for NAICS 211120. Conversion is a
 *      consumer concern, done once, in one place, under test.
 *   2. The comparison is "maximum allowed", i.e. `observed <= threshold`
 *      passes. A concern exactly at the threshold is small.
 *
 * ─── What this file is NOT ──────────────────────────────────────────────
 * NOT Census NAICS classification data. Industry hierarchy, descriptions
 * and search terms come from Census (see src/lib/reference/naics/) and are
 * kept in a separate artifact with separate provenance. SBA assigns size
 * standards at the 6-digit level (plus exceptions); Census defines the
 * hierarchy. Conflating them is how parent-code standards get invented.
 * ────────────────────────────────────────────────────────────────────────
 */

/**
 * How SBA measures size for an industry.
 *
 * `annual_receipts` and `employees` cover §121.201 in full. `assets` exists
 * because a handful of depository-institution rows are stated in millions
 * of dollars of assets rather than receipts — the importer MUST classify
 * those as `assets`, never silently as `annual_receipts`, because the
 * borrower-side input is a completely different number.
 *
 * `other` is a deliberate escape hatch for any row the importer cannot
 * confidently classify. It is NOT a "pass" and NOT a "fail": downstream it
 * must resolve to a data/unresolved state requiring human review. The
 * coverage guard caps how many `other` rows are tolerable so this can never
 * quietly become the majority case (the legacy artifact was 1,039/2,061
 * `other` — i.e. half the table silently unusable).
 */
export type SizeStandardMeasure =
  | "annual_receipts"
  | "employees"
  | "assets"
  | "other";

/**
 * One published §121.201 line.
 *
 * Exception rows ("115310 (Exception 1) — Forest Fire Suppression") share a
 * NAICS code with their base row but carry their own standard and footnote.
 * They are preserved as distinct records keyed by (naics, exceptionLabel);
 * flattening them silently applies the wrong threshold to a real borrower.
 */
export type SbaSizeStandardRecord = {
  /** 6-digit NAICS code. Exception rows repeat their base code. */
  naics: string;
  /**
   * Verbatim exception designator from the table (e.g. "Exception 1"), or
   * null for the base row. Part of the record's identity.
   */
  exceptionLabel: string | null;
  /** SBA's own industry title, verbatim, footnote markers stripped. */
  title: string;
  measure: SizeStandardMeasure;
  /** Receipts standard in MILLIONS of dollars, as published. */
  receiptsMillionsUsd: number | null;
  /** Employee-count standard, as published. */
  employees: number | null;
  /** Asset standard in MILLIONS of dollars, as published. */
  assetsMillionsUsd: number | null;
  /** §121.201 footnote numbers attached to this row, e.g. ["1"]. */
  footnoteRefs: string[];
  /**
   * The source cells, verbatim and untouched. Non-negotiable: it means a
   * parser bug can never destroy the published value, and any row can be
   * audited against the PDF without re-running the import.
   */
  raw: {
    naicsCell: string;
    titleCell: string;
    receiptsCell: string;
    employeesCell: string;
  };
};

/** Counts recomputed from `records` and frozen into the manifest. */
export type SbaSizeStandardCounts = {
  totalRows: number;
  uniqueNaics: number;
  exceptionRows: number;
  receiptsRows: number;
  employeeRows: number;
  assetsRows: number;
  otherRows: number;
};

export type SbaSizeStandardDataset = {
  /** Dataset version, e.g. "2023-03". */
  version: string;
  /** Effective date of the published standards, ISO date. */
  effectiveDate: string;
  sourceName: string;
  sourceUrl: string;
  /** SHA-256 of the exact bytes downloaded from the official source. */
  sourceSha256: string;
  /** ISO timestamp of the import run. */
  importedAt: string;
  /** §121.201 footnote number -> footnote text. */
  footnotes: Record<string, string>;
  counts: SbaSizeStandardCounts;
  records: SbaSizeStandardRecord[];
};

/** The manifest is the dataset minus `records` — cheap to diff in review. */
export type SbaSizeStandardManifest = Omit<SbaSizeStandardDataset, "records"> & {
  /** SHA-256 of the serialized `records` array. Detects silent edits. */
  recordsSha256: string;
};
