/**
 * Runtime loader for the generated SBA size-standard artifact.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 2.
 *
 * Loads once at module scope into an index. No network, no database — the
 * artifact is committed reference data, so a borrower's eligibility never
 * depends on SBA.gov being reachable.
 *
 * If the artifact is missing or fails validation, this does NOT throw at
 * import time and does NOT fall back to any built-in table. It reports the
 * failure, and the eligibility layer turns that into a `data_error` state.
 * A reference-data problem is an operational fault, never a borrower denial.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SbaSizeStandardDataset, SbaSizeStandardRecord } from "./types";
import { validateDataset } from "./validateDataset";

const ARTIFACT_PATH = "data/reference/sba-size-standards.json";

export type DatasetLoadResult =
  | { ok: true; dataset: SbaSizeStandardDataset; index: Map<string, SbaSizeStandardRecord[]> }
  | { ok: false; error: string };

let cached: DatasetLoadResult | null = null;

function load(): DatasetLoadResult {
  try {
    const path = resolve(process.cwd(), ARTIFACT_PATH);
    const dataset = JSON.parse(readFileSync(path, "utf8")) as SbaSizeStandardDataset;

    const errors = validateDataset(dataset).filter((i) => i.severity === "error");
    if (errors.length > 0) {
      return {
        ok: false,
        error:
          `SBA size-standard artifact failed validation: ` +
          errors.map((e) => `[${e.code}] ${e.message}`).join("; "),
      };
    }

    const index = new Map<string, SbaSizeStandardRecord[]>();
    for (const record of dataset.records) {
      const list = index.get(record.naics);
      if (list) list.push(record);
      else index.set(record.naics, [record]);
    }

    return { ok: true, dataset, index };
  } catch (error) {
    return {
      ok: false,
      error: `Could not load ${ARTIFACT_PATH}: ${(error as Error).message}`,
    };
  }
}

export function getDataset(): DatasetLoadResult {
  if (!cached) cached = load();
  return cached;
}

/** Test-only: forces a reload (e.g. after pointing at a fixture). */
export function __resetDatasetCache(): void {
  cached = null;
}

/**
 * All records for a NAICS code: the base row plus any §121.201 exception
 * rows. Returns an empty array when the code is not in the table.
 */
export function lookupRecords(naics: string | null | undefined): SbaSizeStandardRecord[] {
  if (!naics) return [];
  const result = getDataset();
  if (!result.ok) return [];
  return result.index.get(naics.trim()) ?? [];
}

export function datasetEffectiveDate(): string | null {
  const result = getDataset();
  return result.ok ? result.dataset.effectiveDate : null;
}
