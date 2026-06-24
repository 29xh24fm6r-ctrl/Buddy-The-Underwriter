/**
 * Gemini-Primary Response Parser
 *
 * Pure functions — no server imports, no DB. Safe for unit testing.
 *
 * Parses Gemini JSON response → ExtractedLineItem[].
 * Also provides cross-check comparator for drift detection.
 */

import type { ExtractedLineItem } from "../shared";
import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
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

  // SPEC-SPREAD-SYSTEM-PERFECTION-HARDENING-1 (Phase 1): optional per-fact source
  // evidence. Gemini may return a sibling `evidence` map (fact key → verbatim
  // source line) and/or inline evidence on an object-valued fact. Any real
  // snippet is persisted into provenance.citations / raw_snippets so the
  // classic-spread source-line resolver can safely remap/suppress facts. Nothing
  // is fabricated — only strings actually present in the response are used — and
  // the parser is unchanged when evidence is absent (backward compatible).
  const evidenceRecord =
    obj.evidence && typeof obj.evidence === "object" && !Array.isArray(obj.evidence)
      ? (obj.evidence as Record<string, unknown>)
      : {};

  const items: ExtractedLineItem[] = [];

  for (const [key, rawValue] of Object.entries(factsRecord)) {
    // Filter to expected keys only — reject hallucinated keys
    if (!expectedSet.has(key)) continue;

    // A fact value may be a primitive (legacy shape) or an object carrying its
    // own { value, snippet, ... }. Extract the numeric value from either.
    const isObj =
      rawValue !== null && typeof rawValue === "object" && !Array.isArray(rawValue);
    const value = safeNumber(
      isObj ? (rawValue as Record<string, unknown>).value : rawValue,
    );
    rawResponse.facts[key] = value;

    if (value === null) continue;

    const provenance: FinancialFactProvenance = {
      source_type: "DOC_EXTRACT",
      source_ref: `deal_documents:${args.documentId}`,
      as_of_date: periodEnd,
      extractor: "gemini_primary_v1",
      confidence,
    };

    const snippets = collectSnippets(rawValue, evidenceRecord[key]);
    if (snippets.length > 0) {
      const page = isObj
        ? safeNumber((rawValue as Record<string, unknown>).page)
        : null;
      provenance.citations = snippets.map((snippet) => ({ page, snippet }));
      provenance.raw_snippets = snippets;
    }

    items.push({ factKey: key, value, confidence, periodStart, periodEnd, provenance });
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

/**
 * Collect verbatim source-line snippets for one fact, from inline evidence on an
 * object-valued fact and/or the sibling `evidence` map entry. Pure: returns only
 * non-empty strings actually present in the response (deduped, order-preserving).
 * Never fabricates, never uses numeric-only heuristics.
 */
function collectSnippets(rawValue: unknown, evidenceForKey: unknown): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    if (typeof s !== "string") return;
    const t = s.trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  };

  // Inline evidence carried on an object-valued fact.
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    const o = rawValue as Record<string, unknown>;
    push(o.snippet);
    push(o.source_line);
    push(o.sourceLine);
    push(o.text);
    push(o.evidence);
    if (Array.isArray(o.raw_snippets)) for (const s of o.raw_snippets) push(s);
    if (Array.isArray(o.citations))
      for (const c of o.citations)
        if (c && typeof c === "object") push((c as Record<string, unknown>).snippet);
  }

  // Sibling evidence-map entry for this key.
  collectFromEvidence(evidenceForKey, push);

  return out;
}

function collectFromEvidence(ev: unknown, push: (s: unknown) => void): void {
  if (ev == null) return;
  if (typeof ev === "string") {
    push(ev);
    return;
  }
  if (Array.isArray(ev)) {
    for (const e of ev) collectFromEvidence(e, push);
    return;
  }
  if (typeof ev === "object") {
    const o = ev as Record<string, unknown>;
    push(o.snippet);
    push(o.source_line);
    push(o.sourceLine);
    push(o.text);
    if (Array.isArray(o.raw_snippets)) for (const s of o.raw_snippets) push(s);
  }
}

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
