/**
 * Normalizer for the official SBA "Small Business Size Standards - NAICS
 * Data" JSON, the machine-readable feed that powers SBA's own Size
 * Standards Tool.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1 (revised source decision).
 *
 * ─── Why this file leads with a probe instead of a mapping ──────────────
 * As of 2026-08-17 both URLs SBA advertises for this JSON return HTTP 404
 * (see docs in scripts/reference-data/build-sba-size-standards.ts), so the
 * payload's real field names could not be observed. The only published
 * schema hint is the SwaggerHub definition behind the dataset's API
 * resource, which documents the /naics response in terms of
 *   id, description, sectorId, sectorDescription, subsectorId,
 *   subsectorDescription, parent
 * — i.e. CLASSIFICATION fields. No threshold field appears in that list,
 * which is consistent with the tool's sector -> subsector -> NAICS
 * drill-down but leaves open whether receipts/employee standards and
 * §121.201 exception rows are carried in the same payload at all.
 *
 * Guessing a mapping here would be the single most dangerous thing this
 * codebase could do: a wrong field name silently yields a wrong threshold,
 * and a wrong threshold is a wrong eligibility decision for a real
 * borrower. So:
 *
 *   - `describeJsonSchema()` reports what the payload ACTUALLY contains.
 *   - `normalizeSbaJson()` maps only via candidate field names that are
 *     confirmed present, and returns `unmapped` diagnostics for everything
 *     it could not account for.
 *   - If thresholds cannot be located, normalization FAILS. It never
 *     emits a record with a null threshold that would read downstream as
 *     "no size standard".
 *
 * The candidate lists below are hypotheses to be CONFIRMED by the probe
 * against the real file, not assertions about it.
 */

import type { SbaSizeStandardRecord, SizeStandardMeasure } from "./types";

export type JsonSchemaReport = {
  /** Shape of the top-level payload. */
  rootKind: "array" | "object";
  /** If the records live under a wrapper key, which one. */
  recordsPath: string | null;
  recordCount: number;
  /** Every field observed, with how often it is populated and samples. */
  fields: Array<{
    name: string;
    presentInRecords: number;
    populatedInRecords: number;
    types: string[];
    samples: string[];
  }>;
  /** Fields the normalizer would use, once confirmed present. */
  resolvedMapping: {
    naics: string | null;
    title: string | null;
    receipts: string | null;
    employees: string | null;
    exception: string | null;
    footnote: string | null;
  };
  /** Fields present in the payload that the mapping does not consume. */
  unmappedFields: string[];
};

/**
 * Candidate field names, ordered by preference. Derived from the published
 * Swagger parameter names plus the column headings SBA uses in the XLSX and
 * §121.201. NOT confirmed against the live payload.
 */
const CANDIDATES = {
  naics: ["naics", "naicsCode", "naics_code", "code", "id"],
  title: [
    "description",
    "naicsDescription",
    "naics_description",
    "title",
    "industryTitle",
  ],
  receipts: [
    "sizeStandardInMillions",
    "size_standard_in_millions",
    "receipts",
    "annualReceipts",
    "sizeStandardDollars",
    "revenueSizeStandard",
  ],
  employees: [
    "sizeStandardInEmployees",
    "size_standard_in_employees",
    "employees",
    "employeeSizeStandard",
    "employeeCount",
  ],
  exception: ["exception", "exceptionDescription", "footnoteException", "subIndustry"],
  footnote: ["footnote", "footnoteId", "footnoteRef", "footnotes", "notes"],
} as const;

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Locates the record array inside an unknown payload shape. */
export function locateRecords(payload: unknown): {
  records: Record<string, unknown>[];
  path: string | null;
  rootKind: "array" | "object";
} {
  if (Array.isArray(payload)) {
    return { records: payload as Record<string, unknown>[], path: null, rootKind: "array" };
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // Prefer the longest array of objects — SBA wrappers vary ("naics",
    // "data", "results"), so find it structurally rather than by name.
    let best: { key: string; value: Record<string, unknown>[] } | null = null;
    for (const [key, value] of Object.entries(obj)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "object" &&
        value[0] !== null &&
        (!best || value.length > best.value.length)
      ) {
        best = { key, value: value as Record<string, unknown>[] };
      }
    }
    if (best) return { records: best.value, path: best.key, rootKind: "object" };
    return { records: [], path: null, rootKind: "object" };
  }

  return { records: [], path: null, rootKind: "object" };
}

function resolveField(
  fieldNames: Set<string>,
  candidates: readonly string[],
): string | null {
  const lowered = new Map(Array.from(fieldNames, (n) => [n.toLowerCase(), n]));
  for (const candidate of candidates) {
    const hit = lowered.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * Inspects the payload and reports its real structure. Run this FIRST
 * against the official file; its output is what confirms or refutes the
 * candidate mapping above.
 */
export function describeJsonSchema(payload: unknown): JsonSchemaReport {
  const { records, path, rootKind } = locateRecords(payload);

  const stats = new Map<
    string,
    { present: number; populated: number; types: Set<string>; samples: string[] }
  >();

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      let entry = stats.get(key);
      if (!entry) {
        entry = { present: 0, populated: 0, types: new Set(), samples: [] };
        stats.set(key, entry);
      }
      entry.present += 1;
      entry.types.add(typeOf(value));
      if (isPopulated(value)) {
        entry.populated += 1;
        if (entry.samples.length < 3) entry.samples.push(String(value).slice(0, 80));
      }
    }
  }

  const fieldNames = new Set(stats.keys());
  const resolvedMapping = {
    naics: resolveField(fieldNames, CANDIDATES.naics),
    title: resolveField(fieldNames, CANDIDATES.title),
    receipts: resolveField(fieldNames, CANDIDATES.receipts),
    employees: resolveField(fieldNames, CANDIDATES.employees),
    exception: resolveField(fieldNames, CANDIDATES.exception),
    footnote: resolveField(fieldNames, CANDIDATES.footnote),
  };

  const mapped = new Set(Object.values(resolvedMapping).filter(Boolean) as string[]);

  return {
    rootKind,
    recordsPath: path,
    recordCount: records.length,
    fields: Array.from(stats.entries())
      .map(([name, entry]) => ({
        name,
        presentInRecords: entry.present,
        populatedInRecords: entry.populated,
        types: Array.from(entry.types).sort(),
        samples: entry.samples,
      }))
      .sort((a, b) => b.populatedInRecords - a.populatedInRecords),
    resolvedMapping,
    unmappedFields: Array.from(fieldNames).filter((n) => !mapped.has(n)).sort(),
  };
}

export class SbaJsonSchemaError extends Error {
  constructor(
    message: string,
    public readonly report: JsonSchemaReport,
  ) {
    super(message);
    this.name = "SbaJsonSchemaError";
  }
}

export type NormalizeResult = {
  records: SbaSizeStandardRecord[];
  report: JsonSchemaReport;
  /** Records skipped, with the reason. Never silently dropped. */
  rejected: Array<{ reason: string; record: Record<string, unknown> }>;
};

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes the SBA JSON into Buddy records.
 *
 * Throws SbaJsonSchemaError (carrying the full probe report) rather than
 * producing a partial dataset when the payload cannot supply a NAICS code,
 * an industry title, or ANY threshold field. A caller that cannot build a
 * complete dataset must stop and escalate — per the Phase 1 acceptance
 * rule, we do not guess which threshold Buddy should use.
 */
export function normalizeSbaJson(payload: unknown): NormalizeResult {
  const report = describeJsonSchema(payload);
  const { records } = locateRecords(payload);
  const map = report.resolvedMapping;

  if (records.length === 0) {
    throw new SbaJsonSchemaError("SBA JSON contained no record array", report);
  }
  if (!map.naics) {
    throw new SbaJsonSchemaError(
      `Could not locate a NAICS code field. Observed fields: ${report.fields
        .map((f) => f.name)
        .join(", ")}`,
      report,
    );
  }
  if (!map.receipts && !map.employees) {
    throw new SbaJsonSchemaError(
      "SBA JSON carries no receipts or employee size-standard field — it appears " +
        "to be classification-only data. Supplement deterministically from the " +
        "official XLSX or §121.201 instead of inferring thresholds. Observed " +
        `fields: ${report.fields.map((f) => f.name).join(", ")}`,
      report,
    );
  }

  const out: SbaSizeStandardRecord[] = [];
  const rejected: NormalizeResult["rejected"] = [];

  for (const record of records) {
    const rawNaics = String(record[map.naics] ?? "").trim();
    const naics = rawNaics.replace(/\D/g, "");

    // SBA's tool payload includes sector/subsector rows alongside 6-digit
    // industries. Those are classification, not size standards, and are
    // excluded rather than coerced into a 6-digit code.
    if (naics.length !== 6) {
      rejected.push({ reason: `not a 6-digit NAICS code: "${rawNaics}"`, record });
      continue;
    }

    const receiptsValue = map.receipts ? parseNumeric(record[map.receipts]) : null;
    const employeesValue = map.employees ? parseNumeric(record[map.employees]) : null;

    if (receiptsValue != null && employeesValue != null) {
      rejected.push({
        reason: "both receipts and employee standards populated — ambiguous record",
        record,
      });
      continue;
    }

    let measure: SizeStandardMeasure;
    if (employeesValue != null) measure = "employees";
    else if (receiptsValue != null) measure = "annual_receipts";
    else {
      rejected.push({ reason: "no size standard on record", record });
      continue;
    }

    const exceptionRaw = map.exception ? record[map.exception] : null;
    const exceptionLabel =
      isPopulated(exceptionRaw) && String(exceptionRaw).trim()
        ? String(exceptionRaw).trim()
        : null;

    const footnoteRaw = map.footnote ? record[map.footnote] : null;
    const footnoteRefs = isPopulated(footnoteRaw)
      ? String(footnoteRaw)
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => /^\d{1,2}$/.test(s))
      : [];

    out.push({
      naics,
      exceptionLabel,
      title: map.title ? String(record[map.title] ?? "").trim() : "",
      measure,
      receiptsMillionsUsd: measure === "annual_receipts" ? receiptsValue : null,
      employees: measure === "employees" ? employeesValue : null,
      assetsMillionsUsd: null,
      footnoteRefs,
      raw: {
        naicsCell: rawNaics,
        titleCell: map.title ? String(record[map.title] ?? "") : "",
        receiptsCell: map.receipts ? String(record[map.receipts] ?? "") : "",
        employeesCell: map.employees ? String(record[map.employees] ?? "") : "",
      },
    });
  }

  return { records: out, report, rejected };
}

export function formatSchemaReport(report: JsonSchemaReport): string {
  const lines: string[] = [];
  lines.push(`root: ${report.rootKind}${report.recordsPath ? ` (records under "${report.recordsPath}")` : ""}`);
  lines.push(`records: ${report.recordCount}`);
  lines.push("fields:");
  for (const field of report.fields) {
    lines.push(
      `  ${field.name.padEnd(28)} populated ${field.populatedInRecords}/${field.presentInRecords}` +
        `  types=${field.types.join("|")}  e.g. ${field.samples.join(" / ")}`,
    );
  }
  lines.push("resolved mapping:");
  for (const [key, value] of Object.entries(report.resolvedMapping)) {
    lines.push(`  ${key.padEnd(12)} -> ${value ?? "(NOT FOUND)"}`);
  }
  if (report.unmappedFields.length > 0) {
    lines.push(`unmapped fields: ${report.unmappedFields.join(", ")}`);
  }
  return lines.join("\n");
}
