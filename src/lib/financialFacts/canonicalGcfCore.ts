/**
 * SPEC-GCF-SOURCE-OF-TRUTH-AUDIT-AND-CONSOLIDATION-1
 *
 * Pure core of the canonical Global Cash Flow selector — NO "server-only", so
 * it is unit-testable. The server-only async accessor lives in
 * getCanonicalGlobalCashFlow.ts and delegates here.
 *
 * Canonical fact key:  GCF_GLOBAL_CASH_FLOW   (preferred)
 * Legacy alias:        GLOBAL_CASH_FLOW       (read-only fallback, with warning)
 * Canonical spread owner_type: GLOBAL         (DEAL rows are legacy fallback)
 */

export const GCF_CANONICAL_FACT_KEY = "GCF_GLOBAL_CASH_FLOW";
export const GCF_LEGACY_FACT_KEY = "GLOBAL_CASH_FLOW";
export const GCF_DSCR_FACT_KEY = "GCF_DSCR";

export type CanonicalGcfState =
  | "current" // canonical fact present and not being recomputed
  | "legacy_fallback" // only the legacy GLOBAL_CASH_FLOW fact exists
  | "queued" // a GCF spread row is enqueued
  | "generating" // a GCF spread row is being generated
  | "error" // newest relevant GCF spread row failed
  | "missing"; // nothing computed, no inputs / never run

export type CanonicalGcfResult = {
  state: CanonicalGcfState;
  value: number | null;
  gcfDscr: number | null;
  source: "canonical_fact" | "legacy_fact" | "spread" | null;
  factKey: string | null;
  ownerType: string | null;
  asOf: string | null;
  spreadStatus: string | null;
  diagnostics: string[];
  warnings: string[];
};

export type GcfFactRow = {
  fact_key: string;
  fact_value_num: number | null;
  fact_type?: string | null;
  owner_type?: string | null;
  owner_entity_id?: string | null;
  fact_period_end?: string | null;
  created_at?: string | null;
  is_superseded?: boolean | null;
};

export type GcfSpreadRow = {
  status: string;
  owner_type?: string | null;
  updated_at?: string | null;
  error?: string | null;
  error_code?: string | null;
  error_details_json?: unknown;
};

function recency(f: GcfFactRow): string {
  return f.fact_period_end ?? f.created_at ?? "";
}

/** Latest non-superseded fact for a key (prefer canonical DEAL owner, then most recent). */
function latestFact(rows: GcfFactRow[], factKey: string): GcfFactRow | null {
  const candidates = rows.filter(
    (r) => r.fact_key === factKey && r.is_superseded !== true && typeof r.fact_value_num === "number",
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const ad = a.owner_type === "DEAL" || !a.owner_type ? 0 : 1;
    const bd = b.owner_type === "DEAL" || !b.owner_type ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return recency(b).localeCompare(recency(a));
  });
  return candidates[0];
}

/**
 * Resolve the GCF value from canonical facts, preferring GCF_GLOBAL_CASH_FLOW
 * and falling back to the legacy GLOBAL_CASH_FLOW alias. Shared by memo
 * readiness and the selector so they can never diverge.
 */
export function resolveGcfFactValue(rows: GcfFactRow[]): {
  value: number | null;
  factKey: string | null;
  usedLegacy: boolean;
  ownerType: string | null;
  asOf: string | null;
} {
  const canonical = latestFact(rows, GCF_CANONICAL_FACT_KEY);
  if (canonical) {
    return {
      value: canonical.fact_value_num ?? null,
      factKey: GCF_CANONICAL_FACT_KEY,
      usedLegacy: false,
      ownerType: canonical.owner_type ?? null,
      asOf: canonical.fact_period_end ?? null,
    };
  }
  const legacy = latestFact(rows, GCF_LEGACY_FACT_KEY);
  if (legacy) {
    return {
      value: legacy.fact_value_num ?? null,
      factKey: GCF_LEGACY_FACT_KEY,
      usedLegacy: true,
      ownerType: legacy.owner_type ?? null,
      asOf: legacy.fact_period_end ?? null,
    };
  }
  return { value: null, factKey: null, usedLegacy: false, ownerType: null, asOf: null };
}

/** Specific missing-input diagnostics — never just "upload docs". */
function missingInputDiagnostics(factRows: GcfFactRow[]): string[] {
  const has = (key: string, ownerType?: string) =>
    factRows.some(
      (r) =>
        r.fact_key === key &&
        r.is_superseded !== true &&
        typeof r.fact_value_num === "number" &&
        (ownerType == null || r.owner_type === ownerType),
    );
  const diags: string[] = [];
  if (!has("CASH_FLOW_AVAILABLE")) diags.push("Missing business cash flow (CASH_FLOW_AVAILABLE).");
  if (!has("ANNUAL_DEBT_SERVICE")) diags.push("Missing annual debt service (ANNUAL_DEBT_SERVICE).");
  const hasPersonalOwner = factRows.some((r) => r.owner_type === "PERSONAL" && r.owner_entity_id);
  if (!hasPersonalOwner) diags.push("No personal owner / sponsor mapped for personal income.");
  else if (!has("WAGES_W2", "PERSONAL") && !has("SCH_E_RENTAL_TOTAL", "PERSONAL"))
    diags.push("Missing personal income components (e.g. WAGES_W2 / SCH_E_RENTAL_TOTAL).");
  if (!has("PFS_ANNUAL_DEBT_SERVICE", "PERSONAL"))
    diags.push("Missing personal debt service from PFS (PFS_ANNUAL_DEBT_SERVICE).");
  if (!has("PFS_LIVING_EXPENSES", "PERSONAL"))
    diags.push("Missing personal living expenses from PFS (PFS_LIVING_EXPENSES).");
  return diags;
}

/**
 * Pure resolver. Given the GCF spread rows and the deal's financial facts,
 * return the canonical GCF result with state, value, source, and diagnostics.
 */
export function resolveCanonicalGcf(input: {
  spreadRows: GcfSpreadRow[];
  factRows: GcfFactRow[];
}): CanonicalGcfResult {
  const { spreadRows, factRows } = input;

  // Spread status: prefer the canonical GLOBAL-owned row over legacy DEAL rows
  // so a stale DEAL row can never mask an active/ready GLOBAL row.
  const sortedSpreads = [...spreadRows].sort((a, b) => {
    const ag = a.owner_type === "GLOBAL" ? 0 : 1;
    const bg = b.owner_type === "GLOBAL" ? 0 : 1;
    if (ag !== bg) return ag - bg;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
  const isGenerating = spreadRows.some((s) => s.status === "generating");
  const isQueued = spreadRows.some((s) => s.status === "queued");
  const errorRow = sortedSpreads.find((s) => s.status === "error") ?? null;

  const fact = resolveGcfFactValue(factRows);
  const dscr = latestFact(factRows, GCF_DSCR_FACT_KEY)?.fact_value_num ?? null;

  const base: CanonicalGcfResult = {
    state: "missing",
    value: fact.value,
    gcfDscr: dscr,
    source: fact.factKey ? (fact.usedLegacy ? "legacy_fact" : "canonical_fact") : null,
    factKey: fact.factKey,
    ownerType: fact.ownerType,
    asOf: fact.asOf,
    spreadStatus: sortedSpreads[0]?.status ?? null,
    diagnostics: [],
    warnings: [],
  };

  // A compute in flight always reports computing — never "missing" — even if a
  // prior value exists (we still return that prior value for last-known display).
  if (isGenerating) return { ...base, state: "generating" };
  if (isQueued) return { ...base, state: "queued" };

  if (fact.factKey === GCF_CANONICAL_FACT_KEY) {
    return { ...base, state: "current" };
  }
  if (fact.usedLegacy) {
    return {
      ...base,
      state: "legacy_fallback",
      warnings: [
        "Using legacy GLOBAL_CASH_FLOW fact — canonical GCF_GLOBAL_CASH_FLOW not materialized. Recompute to refresh.",
      ],
    };
  }
  if (errorRow) {
    const detail =
      errorRow.error_code || errorRow.error
        ? `${errorRow.error_code ?? "error"}: ${errorRow.error ?? "computation failed"}`
        : "Global cash flow computation failed.";
    return { ...base, state: "error", diagnostics: [detail, ...missingInputDiagnostics(factRows)] };
  }
  return { ...base, state: "missing", diagnostics: missingInputDiagnostics(factRows) };
}
