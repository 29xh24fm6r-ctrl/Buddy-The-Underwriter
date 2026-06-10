/**
 * SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1
 *
 * One reconciled, source-attributed canonical spread view model. Period columns carry
 * a true audit method derived from the ACTUAL facts used in the column (their
 * source_canonical_type), never inferred from the date. Facts are reconciled first
 * (reuses reconcileFinancialFacts) so quarantined/impossible/duplicate facts never
 * feed a column.
 *
 * The pure core (deriveColumnSourceAttribution / buildSpreadColumns) is DB-free and
 * testable; the IO builder buildCanonicalSpreadViewModel loads + reconciles facts.
 */

import {
  reconcileFinancialFacts,
  type ReconcileFact,
  type ConfidenceTier,
} from "@/lib/financialFacts/reconcileFinancialFacts";

export type AuditMethod =
  | "Tax Return"
  | "Company Prepared"
  | "Interim"
  | "Mixed Sources"
  | "Computed"
  | "Unknown";

export type SpreadColumnFact = {
  fact_key: string;
  fact_value_num: number | null;
  fact_period_start: string | null;
  fact_period_end: string | null;
  source_canonical_type: string | null;
  source_document_id: string | null;
  extractor: string | null;
};

export type SpreadPeriodColumn = {
  periodEnd: string;
  statementDate: string; // MM/DD/YYYY
  monthsCovered: number | null;
  statementType: "Annual" | "Interim" | "Computed" | "Unknown";
  auditMethod: AuditMethod;
  sourceCanonicalTypes: string[];
  sourceDocumentIds: string[];
};

// ── source-type → category ────────────────────────────────────────────────
function categoryOf(sct: string | null, extractor: string | null): "tax" | "company" | "computed" | "unknown" {
  const s = (sct ?? "").toUpperCase();
  const ex = (extractor ?? "").toLowerCase();
  if (s.includes("TAX_RETURN")) return "tax";
  if (s.includes("FINANCIAL_STATEMENT") || s.includes("INCOME_STATEMENT") || s.includes("BALANCE_SHEET") || s.includes("OPERATING_STATEMENT") || s.includes("RENT_ROLL")) return "company";
  if (ex.includes("compute") || ex.includes("aggregator") || ex.includes("template") || ex.includes("backfill") || ex.includes("waterfall")) return "computed";
  if (s) return "company"; // any other extracted statement source
  return "unknown";
}

function fmtDate(periodEnd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!m) return periodEnd;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** Months covered from period_start..period_end, else inferred from the period-end month. */
function monthsCovered(start: string | null, end: string): number | null {
  if (start) {
    const s = new Date(start + "T00:00:00Z");
    const e = new Date(end + "T00:00:00Z");
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && e >= s) {
      const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth()) + 1;
      if (months >= 1 && months <= 12) return months;
    }
  }
  // Infer span from the period-end month (calendar-year assumption): 12-31 → 12, 03-31 → 3, etc.
  const mm = /^\d{4}-(\d{2})-\d{2}$/.exec(end);
  if (mm) return parseInt(mm[1], 10);
  return null;
}

/**
 * Derive a column's source attribution from the ACTUAL facts used (never from the date).
 * Returns null when the column has no usable facts (caller suppresses empty columns).
 */
export function deriveColumnSourceAttribution(facts: SpreadColumnFact[], periodEnd: string): SpreadPeriodColumn | null {
  const usable = facts.filter((f) => f.fact_value_num !== null && f.fact_period_end === periodEnd);
  if (usable.length === 0) return null;

  const cats = new Set(usable.map((f) => categoryOf(f.source_canonical_type, f.extractor)));
  const realCats = new Set([...cats].filter((c) => c === "tax" || c === "company"));

  const start = usable.map((f) => f.fact_period_start).filter((v): v is string => !!v).sort()[0] ?? null;
  const months = monthsCovered(start, periodEnd);

  let auditMethod: AuditMethod;
  let statementType: SpreadPeriodColumn["statementType"];
  if (realCats.size > 1) {
    auditMethod = "Mixed Sources";
    statementType = months !== null && months < 12 ? "Interim" : "Annual";
  } else if (realCats.has("tax")) {
    auditMethod = "Tax Return";
    statementType = "Annual";
  } else if (realCats.has("company")) {
    // Company-prepared: interim when fewer than 12 months are covered.
    if (months !== null && months < 12) {
      auditMethod = "Interim";
      statementType = "Interim";
    } else {
      auditMethod = "Company Prepared";
      statementType = "Annual";
    }
  } else if (cats.has("computed")) {
    auditMethod = "Computed";
    statementType = "Computed";
  } else {
    auditMethod = "Unknown";
    statementType = "Unknown";
  }

  const sourceCanonicalTypes = [...new Set(usable.map((f) => f.source_canonical_type).filter((v): v is string => !!v))].sort();
  const sourceDocumentIds = [...new Set(usable.map((f) => f.source_document_id).filter((v): v is string => !!v))].sort();

  return {
    periodEnd,
    statementDate: fmtDate(periodEnd),
    monthsCovered: months,
    statementType,
    auditMethod,
    sourceCanonicalTypes,
    sourceDocumentIds,
  };
}

export type CanonicalSpreadViewModel = {
  columns: SpreadPeriodColumn[];
  selectedFacts: ReconcileFact[];
  rejectedFacts: ReconcileFact[];
  confidenceTier: ConfidenceTier;
  caveats: string[];
  /** Global cash flow is preliminary when personal facts are unresolved/blocked. */
  gcfPreliminary: boolean;
};

/**
 * Pure builder: reconcile facts, then attribute one column per distinct fact_period_end
 * (DEAL/ENTITY business facts), suppressing empty columns. Personal-fact reconciliation
 * `blocked` drives gcfPreliminary.
 */
export function buildSpreadColumns(reconcileInput: (ReconcileFact & SpreadColumnFact)[]): CanonicalSpreadViewModel {
  const reconciliation = reconcileFinancialFacts(reconcileInput);
  const selectedSet = new Set(reconciliation.selected.map((f) => f.id ?? `${f.fact_key}|${f.fact_period_end}|${f.owner_type}|${f.owner_entity_id}`));

  // Columns from business (DEAL/ENTITY) selected facts only.
  const colFacts = reconcileInput.filter(
    (f) =>
      f.owner_type !== "PERSONAL" &&
      selectedSet.has(f.id ?? `${f.fact_key}|${f.fact_period_end}|${f.owner_type}|${f.owner_entity_id}`),
  );
  const periods = [...new Set(colFacts.map((f) => f.fact_period_end).filter((v): v is string => !!v))].sort().reverse();
  const columns: SpreadPeriodColumn[] = [];
  for (const p of periods) {
    const col = deriveColumnSourceAttribution(colFacts, p);
    if (col) columns.push(col); // empty columns suppressed
  }

  // Personal-fact reconciliation drives the GCF preliminary gate.
  const personalRecon = reconcileFinancialFacts(reconcileInput.filter((f) => f.owner_type === "PERSONAL"));

  return {
    columns,
    selectedFacts: reconciliation.selected,
    rejectedFacts: reconciliation.rejected.map((r) => r.fact),
    confidenceTier: reconciliation.confidenceTier,
    caveats: [...reconciliation.caveats, ...personalRecon.caveats],
    gcfPreliminary: personalRecon.blocked,
  };
}
