/**
 * Gemini-Primary Response Parser
 *
 * Pure functions — no server imports, no DB. Safe for unit testing.
 *
 * Parses Gemini JSON response → ExtractedLineItem[].
 * Also provides cross-check comparator for drift detection.
 */

import type { ExtractedLineItem } from "../shared";
import type {
  GeminiRawResponse,
  CrossCheckResult,
  CrossCheckDriftItem,
} from "./types";
import type { PureLineItem } from "../deterministic/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_GEMINI_CONFIDENCE = 0.80;
const DEFAULT_DRIFT_THRESHOLD = 0.10; // 10%

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

/**
 * Parse Gemini raw JSON into ExtractedLineItem array.
 *
 * Filters to expectedKeys only — rejects hallucinated keys.
 * Returns { items, rawResponse } where rawResponse is preserved for cross-check.
 */
export function parseGeminiResponse(args: {
  rawJson: unknown;
  expectedKeys: string[];
  docType: string;
  documentId: string;
  factType: string;
  periodStart: string | null;
  periodEnd: string | null;
  confidence?: number;
}): { items: ExtractedLineItem[]; rawResponse: GeminiRawResponse | null } {
  const confidence = args.confidence ?? DEFAULT_GEMINI_CONFIDENCE;

  if (!args.rawJson || typeof args.rawJson !== "object") {
    return { items: [], rawResponse: null };
  }

  const obj = args.rawJson as Record<string, unknown>;
  const facts = obj.facts;
  const metadata = obj.metadata;

  if (!facts || typeof facts !== "object") {
    return { items: [], rawResponse: null };
  }

  const factsRecord = facts as Record<string, unknown>;
  const metadataRecord = (metadata && typeof metadata === "object"
    ? metadata
    : {}) as Record<string, unknown>;

  // Build raw response for cross-check
  const rawResponse: GeminiRawResponse = {
    facts: {},
    metadata: {
      tax_year: safeNumber(metadataRecord.tax_year),
      entity_name: safeString(metadataRecord.entity_name),
      form_type: safeString(metadataRecord.form_type),
      period_start: safeString(metadataRecord.period_start),
      period_end: safeString(metadataRecord.period_end),
      ein: safeString(metadataRecord.ein),
      taxpayer_name: safeString(metadataRecord.taxpayer_name),
      filing_status: safeString(metadataRecord.filing_status),
    },
  };

  // Resolve periods: prefer metadata, fall back to caller-provided
  const periodStart =
    rawResponse.metadata.period_start ?? args.periodStart;
  const periodEnd =
    rawResponse.metadata.period_end ?? args.periodEnd;

  const expectedSet = new Set(args.expectedKeys);
  const items: ExtractedLineItem[] = [];

  for (const [key, rawValue] of Object.entries(factsRecord)) {
    // Filter to expected keys only — reject hallucinated keys
    if (!expectedSet.has(key)) continue;

    const value = safeNumber(rawValue);
    rawResponse.facts[key] = value;

    if (value === null) continue;

    items.push({
      factKey: key,
      value,
      confidence,
      periodStart,
      periodEnd,
      provenance: {
        source_type: "DOC_EXTRACT",
        source_ref: `deal_documents:${args.documentId}`,
        as_of_date: periodEnd,
        extractor: "gemini_primary_v1",
        confidence,
      },
    });
  }

  return { items, rawResponse };
}

// ---------------------------------------------------------------------------
// Cross-check comparator
// ---------------------------------------------------------------------------

/**
 * Compare Gemini extraction results against deterministic pure extraction.
 *
 * Computes per-key variance. Drift is detected if any key has variance > threshold.
 */
export function compareExtractions(args: {
  geminiItems: ExtractedLineItem[];
  deterministicItems: PureLineItem[];
  driftThreshold?: number;
}): CrossCheckResult {
  const threshold = args.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD;

  // Build key → value maps
  const geminiMap = new Map<string, number>();
  for (const item of args.geminiItems) {
    geminiMap.set(item.factKey, item.value);
  }

  const deterministicMap = new Map<string, number>();
  for (const item of args.deterministicItems) {
    if (typeof item.value === "number") {
      deterministicMap.set(item.key, item.value);
    }
  }

  // Find overlapping keys
  const allKeys = new Set([...geminiMap.keys(), ...deterministicMap.keys()]);
  const driftItems: CrossCheckDriftItem[] = [];
  let totalCompared = 0;
  let matchCount = 0;

  for (const key of allKeys) {
    const gVal = geminiMap.get(key) ?? null;
    const dVal = deterministicMap.get(key) ?? null;

    // Only compare when both have a value
    if (gVal === null || dVal === null) continue;

    totalCompared++;

    const denominator = Math.max(Math.abs(gVal), Math.abs(dVal), 1);
    const variancePct = Math.abs(gVal - dVal) / denominator;

    if (variancePct <= threshold) {
      matchCount++;
    } else {
      driftItems.push({
        key,
        geminiValue: gVal,
        deterministicValue: dVal,
        variancePct,
      });
    }
  }

  return {
    driftDetected: driftItems.length > 0,
    driftItems,
    totalCompared,
    matchCount,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number" && !isNaN(val) && isFinite(val)) return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val.replace(/[,$]/g, ""));
    if (!isNaN(parsed) && isFinite(parsed)) return parsed;
  }
  return null;
}

function safeString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  return null;
}
