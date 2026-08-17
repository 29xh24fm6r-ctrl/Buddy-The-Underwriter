/**
 * Cross-check between independently sourced size-standard record sets.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1.
 *
 * Buddy takes the SBA JSON as its base dataset and verifies it against the
 * official XLSX and, where available, 13 CFR §121.201. This module answers
 * one question: do these sources agree?
 *
 * ─── The acceptance rule this implements ────────────────────────────────
 * If the sources disagree MATERIALLY — a different threshold, a different
 * measure, or a code present in one and absent from another — the importer
 * STOPS. It does not pick a winner. Choosing between two government sources
 * that contradict each other is a human decision with regulatory
 * consequences, and silently preferring one would hide exactly the kind of
 * defect this cross-check exists to surface.
 *
 * Non-material differences (title punctuation, casing, whitespace) are
 * reported as informational and do not block.
 */

import type { SbaSizeStandardRecord } from "./types";
import { recordKey } from "./parseSizeStandardRow";

export type DiscrepancySeverity = "material" | "informational";

export type Discrepancy = {
  severity: DiscrepancySeverity;
  kind:
    | "missing_in_base"
    | "missing_in_reference"
    | "measure_mismatch"
    | "threshold_mismatch"
    | "title_mismatch";
  key: string;
  detail: string;
};

export type CrossCheckResult = {
  baseLabel: string;
  referenceLabel: string;
  comparedKeys: number;
  discrepancies: Discrepancy[];
  materialCount: number;
};

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function thresholdOf(record: SbaSizeStandardRecord): number | null {
  return (
    record.receiptsMillionsUsd ?? record.employees ?? record.assetsMillionsUsd ?? null
  );
}

function describe(record: SbaSizeStandardRecord): string {
  const value = thresholdOf(record);
  const unit =
    record.measure === "employees"
      ? "employees"
      : record.measure === "assets"
        ? "$M assets"
        : "$M receipts";
  return value == null ? `${record.measure} (no value)` : `${value} ${unit}`;
}

export function crossCheckRecords(args: {
  base: readonly SbaSizeStandardRecord[];
  reference: readonly SbaSizeStandardRecord[];
  baseLabel: string;
  referenceLabel: string;
  /**
   * When the reference is a partial extract (e.g. a §121.201 spot-check
   * subset), codes absent from it are not evidence of a defect.
   */
  referenceIsPartial?: boolean;
}): CrossCheckResult {
  const { base, reference, baseLabel, referenceLabel, referenceIsPartial = false } = args;

  const baseByKey = new Map(base.map((r) => [recordKey(r), r]));
  const refByKey = new Map(reference.map((r) => [recordKey(r), r]));
  const discrepancies: Discrepancy[] = [];

  for (const [key, refRecord] of refByKey) {
    const baseRecord = baseByKey.get(key);
    if (!baseRecord) {
      discrepancies.push({
        severity: "material",
        kind: "missing_in_base",
        key,
        detail:
          `present in ${referenceLabel} (${describe(refRecord)}) but absent from ` +
          `${baseLabel}. If this is an exception row, the base source does not ` +
          `carry exceptions and must be supplemented from ${referenceLabel}.`,
      });
      continue;
    }

    if (baseRecord.measure !== refRecord.measure) {
      discrepancies.push({
        severity: "material",
        kind: "measure_mismatch",
        key,
        detail:
          `${baseLabel} says ${baseRecord.measure}, ${referenceLabel} says ` +
          `${refRecord.measure}. Measuring a borrower on the wrong axis is a ` +
          `wrong eligibility decision — resolve before shipping.`,
      });
      continue;
    }

    const baseValue = thresholdOf(baseRecord);
    const refValue = thresholdOf(refRecord);
    if (baseValue !== refValue) {
      discrepancies.push({
        severity: "material",
        kind: "threshold_mismatch",
        key,
        detail: `${baseLabel}=${describe(baseRecord)} vs ${referenceLabel}=${describe(refRecord)}`,
      });
      continue;
    }

    if (
      baseRecord.title &&
      refRecord.title &&
      normalizeTitle(baseRecord.title) !== normalizeTitle(refRecord.title)
    ) {
      discrepancies.push({
        severity: "informational",
        kind: "title_mismatch",
        key,
        detail: `"${baseRecord.title}" vs "${refRecord.title}"`,
      });
    }
  }

  if (!referenceIsPartial) {
    for (const [key, baseRecord] of baseByKey) {
      if (!refByKey.has(key)) {
        discrepancies.push({
          severity: "material",
          kind: "missing_in_reference",
          key,
          detail:
            `present in ${baseLabel} (${describe(baseRecord)}) but absent from ` +
            `${referenceLabel}`,
        });
      }
    }
  }

  return {
    baseLabel,
    referenceLabel,
    comparedKeys: refByKey.size,
    discrepancies,
    materialCount: discrepancies.filter((d) => d.severity === "material").length,
  };
}

export function formatCrossCheck(result: CrossCheckResult, limit = 40): string {
  const lines = [
    `${result.baseLabel} vs ${result.referenceLabel}: ` +
      `${result.comparedKeys} keys compared, ${result.materialCount} material, ` +
      `${result.discrepancies.length - result.materialCount} informational`,
  ];
  for (const d of result.discrepancies.slice(0, limit)) {
    lines.push(`  [${d.severity}/${d.kind}] ${d.key}: ${d.detail}`);
  }
  if (result.discrepancies.length > limit) {
    lines.push(`  … ${result.discrepancies.length - limit} more`);
  }
  return lines.join("\n");
}
