/**
 * SPEC-CLASSIC-SPREAD-BS-SOURCE-LINE-PARITY-2 — balance-sheet source-line resolver (pure).
 *
 * Sits between extracted facts and the classic-spread period maps. It corrects three source-line
 * MISCLASSIFICATIONS using the fact's PROVENANCE / source-line snippet — never a blind numeric
 * heuristic — and emits an audit entry for each correction. It re-keys or suppresses facts in an
 * in-memory copy; it NEVER mutates or deletes the underlying facts, changes income-statement keys,
 * touches reconcileFinancialFacts, or alters schema/routes/PDF rendering.
 *
 *   1. OCL_RECLASSIFIED_CURRENT — Schedule L "Other current liabilities" (Statement 2) is a CURRENT
 *      liability. Extraction historically lands it under SL_OTHER_LIABILITIES (treated non-current).
 *      Remap to SL_OPERATING_CURRENT_LIABILITIES only when the source line says "other CURRENT
 *      liabilities" (and NOT when it says long-term / non-current / line 20-21).
 *   2. MICRO_STUB_SUPPRESSED — OCR line-number stubs (e.g. "line 3, 6", "line 6 from line 4",
 *      "Line 10: 10") whose value is the line number, not a dollar amount. Suppress only when the
 *      provenance matches the stub signature AND a stronger same-period fact contradicts them.
 *   3. INTERIM_AR_REMAPPED — an interim/company-prepared "Accounts receivable" line that landed under
 *      TOTAL_CURRENT_ASSETS. Remap to SL_AR_GROSS when the source line says accounts receivable; keep
 *      TOTAL_CURRENT_ASSETS only when the source line actually says total current assets.
 */

export type SourceLineSeverity = "warning" | "blocker";
export type SourceLineCode =
  | "OCL_RECLASSIFIED_CURRENT"
  | "MICRO_STUB_SUPPRESSED"
  | "INTERIM_AR_REMAPPED";

export type BalanceSheetSourceLineAudit = {
  periodEnd: string;
  /** the key the fact was extracted under */
  originalKey: string;
  /** the key it was resolved to, or null when the fact was suppressed */
  resolvedKey: string | null;
  value: number | null;
  /** the provenance / source-line snippet that justified the decision */
  sourceLine: string | null;
  code: SourceLineCode;
  severity: SourceLineSeverity;
  reason: string;
};

/** Minimal fact shape the resolver needs — a superset of the loader's RawFact. */
export interface SourceLineFact {
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
  provenance?: unknown;
  source_canonical_type?: string | null;
  confidence?: number | null;
}

// ── thresholds (shared with certifyFactSelection's magnitude tiers) ─────────────────────────────
const MICRO_ABS = 100;
const MATERIAL_MIN = 1000;

// ── provenance snippet extraction ───────────────────────────────────────────────────────────────

/** Flatten a fact's provenance JSON into a single searchable source-line string. */
export function provenanceSnippet(provenance: unknown): string {
  if (!provenance || typeof provenance !== "object") return "";
  const p = provenance as { citations?: Array<{ snippet?: unknown }>; raw_snippets?: unknown[] };
  const parts: string[] = [];
  if (Array.isArray(p.citations)) {
    for (const c of p.citations) if (c && typeof c.snippet === "string") parts.push(c.snippet);
  }
  if (Array.isArray(p.raw_snippets)) {
    for (const s of p.raw_snippets) if (typeof s === "string") parts.push(s);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// ── source-line signatures (provenance-scoped — no numeric-only triggers) ───────────────────────

const CURRENT_LIABILITY_RE = /other\s+current\s+liabilit|line\s+18\b|current\s+liabilities?\s*\(statement/i;
const NON_CURRENT_LIABILITY_RE = /long[-\s]?term|non[-\s]?current|line\s+2[01]\b/i;

const AR_RE = /accounts?\s+receivable|\ba\/r\b|trade\s+receivable/i;
const TOTAL_CURRENT_ASSETS_RE = /total\s+current\s+assets?/i;

/** OCR line-number stub: a multi-line reference or a "Line N: N" where the value equals the line #. */
function isMicroStubSnippet(snippet: string): boolean {
  if (!snippet) return false;
  if (/\bline\s+\d+\s*,\s*\d+/i.test(snippet)) return true; // "line 3, 6"
  if (/\bline\s+\d+\s+from\s+line\s+\d+/i.test(snippet)) return true; // "line 6 from line 4"
  const m = snippet.match(/\bline\s+(\d+)\s*[:]\s*(\d+)\b/i); // "Line 10: 10" — value IS the line number
  if (m && m[1] === m[2]) return true;
  return false;
}

const isCurrentLiabilityKey = (k: string) => k === "SL_OTHER_LIABILITIES";
const isTotalCurrentAssetsKey = (k: string) => k === "SL_TOTAL_CURRENT_ASSETS" || k === "TOTAL_CURRENT_ASSETS";

// ── resolver ────────────────────────────────────────────────────────────────────────────────────

/**
 * Apply the three source-line corrections. Returns a NEW fact array (re-keyed / suppressed) plus the
 * audit trail. Generic over the caller's fact type so the loader's RawFact[] passes through with all
 * its other columns intact.
 */
export function resolveBalanceSheetSourceLines<T extends SourceLineFact>(
  facts: T[],
): { facts: T[]; audit: BalanceSheetSourceLineAudit[] } {
  const audit: BalanceSheetSourceLineAudit[] = [];
  const out: T[] = [];

  // Pre-index per period for the micro-stub "stronger same-period fact" contradiction check.
  const byPeriod = new Map<string, T[]>();
  for (const fct of facts) {
    const pe = fct.fact_period_end?.slice(0, 10);
    if (!pe) continue;
    if (!byPeriod.has(pe)) byPeriod.set(pe, []);
    byPeriod.get(pe)!.push(fct);
  }

  const hasStrongerSamePeriodFact = (period: string, stub: T): boolean => {
    const peers = byPeriod.get(period) ?? [];
    const stubConf = stub.confidence ?? 0;
    return peers.some((g) => {
      if (g === stub) return false;
      const v = g.fact_value_num;
      if (v == null || Math.abs(v) < MATERIAL_MIN) return false;
      if ((g.confidence ?? 0) < stubConf) return false;
      // a peer that is itself a stub cannot be the "stronger" contradiction.
      return !isMicroStubSnippet(provenanceSnippet(g.provenance));
    });
  };

  for (const fct of facts) {
    const period = fct.fact_period_end?.slice(0, 10) ?? null;
    const value = fct.fact_value_num;
    const snippet = provenanceSnippet(fct.provenance);

    if (period == null || value == null) {
      out.push(fct);
      continue;
    }

    // #2 — OCR micro-stub suppression (provenance signature + stronger same-period contradiction).
    if (Math.abs(value) < MICRO_ABS && isMicroStubSnippet(snippet) && hasStrongerSamePeriodFact(period, fct)) {
      audit.push({
        periodEnd: period, originalKey: fct.fact_key, resolvedKey: null, value,
        sourceLine: snippet || null, code: "MICRO_STUB_SUPPRESSED", severity: "warning",
        reason: `${fct.fact_key} value ${value} is an OCR line-number stub (provenance "${snippet}"); a stronger same-period sourced fact contradicts it. Suppressed from the rendered spread (not deleted).`,
      });
      continue; // dropped from the in-memory fact set
    }

    // #1 — Schedule L "Other current liabilities" → current-liability bucket (source-line scoped).
    if (isCurrentLiabilityKey(fct.fact_key) && CURRENT_LIABILITY_RE.test(snippet) && !NON_CURRENT_LIABILITY_RE.test(snippet)) {
      audit.push({
        periodEnd: period, originalKey: fct.fact_key, resolvedKey: "SL_OPERATING_CURRENT_LIABILITIES",
        value, sourceLine: snippet || null, code: "OCL_RECLASSIFIED_CURRENT", severity: "warning",
        reason: `Source line "${snippet}" identifies Schedule L Other CURRENT Liabilities; reclassified from SL_OTHER_LIABILITIES (non-current) to SL_OPERATING_CURRENT_LIABILITIES.`,
      });
      out.push({ ...fct, fact_key: "SL_OPERATING_CURRENT_LIABILITIES" });
      continue;
    }

    // #3 — interim "Accounts receivable" mislabeled as Total Current Assets (source-line scoped).
    if (isTotalCurrentAssetsKey(fct.fact_key) && AR_RE.test(snippet) && !TOTAL_CURRENT_ASSETS_RE.test(snippet)) {
      audit.push({
        periodEnd: period, originalKey: fct.fact_key, resolvedKey: "SL_AR_GROSS",
        value, sourceLine: snippet || null, code: "INTERIM_AR_REMAPPED", severity: "warning",
        reason: `Source line "${snippet}" identifies Accounts Receivable, not Total Current Assets; remapped ${fct.fact_key} → SL_AR_GROSS so it is no longer treated as the current-asset total.`,
      });
      out.push({ ...fct, fact_key: "SL_AR_GROSS" });
      continue;
    }

    out.push(fct);
  }

  return { facts: out, audit };
}
