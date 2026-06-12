/**
 * SPEC-CLASSIC-SPREAD-GCF-CERTIFICATION-1 (Phase 4)
 *
 * Certify Global Cash Flow rows for the classic spread. A GCF value is only certified when its
 * source period is coherent with the period the row is LABELED under, and when the personal-
 * income inputs it depends on are not blocked. This prevents the verified defect where the GCF
 * page shows "Tax Year 2022" while the entity cash-flow value traces to a 2026-03-31 interim
 * (or to the sentinel 1900-01-01 period that the cash-flow aggregator stamps).
 *
 * Period coherence rules:
 *   - tax_year / fiscal_year label → source must be the SAME year and a year-end (12-31); an
 *     interim (non-12-31) or different-year source masquerading as a tax year is BLOCKED.
 *   - interim label → source must carry a known period of the same year; certifies as interim.
 *   - an unknown/sentinel source period (year < 2000) is never coherent with a real label.
 *
 * Dependency rules (personal income, from Phase 3):
 *   - a row that depends on personal income that is BLOCKED → blocked (never a clean GCF).
 *   - depends on PRELIMINARY personal income → certified-but-preliminary (limited), not clean.
 *
 * Pure (no DB, no IO). Imports nothing from reconcileFinancialFacts / the canonical VM. No
 * PDF/row-builder/schema/route change — wiring is Phase 6.
 */

import {
  certifiedDirectFact,
  certifiedBlocked,
  certifiedUnavailable,
  type CertifiedSpreadValue,
} from "./certifiedSpreadValue";
import { auditRowFromValue, type CertifiedAuditRow } from "./certifiedSpreadAudit";

/** Personal-income dependency status handed in from Phase 3 certification. */
export type GcfDependencyStatus = "ok" | "preliminary" | "blocked";

export type GcfLabelKind = "tax_year" | "fiscal_year" | "interim";

/** A candidate fact that could back a GCF row, carrying its ACTUAL source period. */
export type GcfSourceFact = {
  id: string | null;
  factKey: string;
  value: number | null;
  /** the real period/date the value was computed for (or a sentinel when provenance is lost) */
  sourcePeriod: string | null;
  ownerType: string;
  ownerEntityId: string | null;
  documentId: string | null;
  canonicalType: string | null;
  factType?: string | null;
  confidence: number | null;
  extractor: string | null;
  is_superseded?: boolean | null;
  resolution_status?: string | null;
};

export type GcfRowInput = {
  row: string;
  /** the period/label the row is presented under (e.g. "2022", "Tax Year 2024", "2026-03-31") */
  labelPeriod: string;
  labelKind: GcfLabelKind;
  /** when true, this row's value derives from personal income (subject to the dependency gate) */
  dependsOnPersonalIncome?: boolean;
  sources: GcfSourceFact[];
};

export type GcfRejected = {
  factId: string | null;
  value: number | null;
  sourcePeriod: string | null;
  sourceFamily: string | null;
  reason: string;
};

export type GcfCertification = {
  row: string;
  value: CertifiedSpreadValue;
  /** certified but limited (e.g. personal-income preliminary) — not a clean certification */
  preliminary: boolean;
  labelPeriod: string;
  labelKind: GcfLabelKind;
  sourcePeriod: string | null;
  sourceFamily: string | null;
  ownerContext: string | null;
  dependencyStatus: GcfDependencyStatus;
  rejected: GcfRejected[];
  reason: string;
};

export type CertifiedGlobalCashFlow = {
  certifications: GcfCertification[];
  auditRows: CertifiedAuditRow[];
};

const NON_SELECTABLE_STATUSES = new Set(["rejected", "system_invalidated"]);

function yearOf(period: string | null): number | null {
  if (!period) return null;
  const m = /(\d{4})/.exec(period);
  return m ? parseInt(m[1], 10) : null;
}
function isYearEnd(period: string | null): boolean {
  return !!period && /-12-31$/.test(period);
}
function isSentinelOrUnknown(period: string | null): boolean {
  const y = yearOf(period);
  return y === null || y < 2000;
}

function sourceFamily(s: GcfSourceFact): string {
  const sct = (s.canonicalType ?? "").toUpperCase();
  const ex = (s.extractor ?? "").toLowerCase();
  const ft = (s.factType ?? "").toUpperCase();
  if (ex.includes("gcftemplate") || ex.includes("cashflowaggregator") || ft.includes("FINANCIAL_ANALYSIS")) return "COMPUTED_CASH_FLOW";
  if (sct.includes("TAX_RETURN")) return "TAX_RETURN";
  if (sct.includes("INCOME_STATEMENT") || sct.includes("FINANCIAL_STATEMENT") || sct.includes("OPERATING")) return "COMPANY_STATEMENT";
  return sct || ft || "UNKNOWN";
}

/** Decide whether a source's period is coherent with the row's label. */
function evaluatePeriod(
  labelPeriod: string,
  labelKind: GcfLabelKind,
  sourcePeriod: string | null,
): { coherent: boolean; reason: string } {
  const labelYear = yearOf(labelPeriod);
  const srcYear = yearOf(sourcePeriod);

  if (isSentinelOrUnknown(sourcePeriod)) {
    return { coherent: false, reason: `source period ${sourcePeriod ?? "unknown"} has no usable provenance (cannot back a ${labelKind} label "${labelPeriod}").` };
  }

  if (labelKind === "tax_year" || labelKind === "fiscal_year") {
    if (labelYear === null || srcYear === null || srcYear !== labelYear) {
      return { coherent: false, reason: `${labelKind} label "${labelPeriod}" conflicts with source period ${sourcePeriod} (year ${srcYear ?? "?"} ≠ ${labelYear ?? "?"}).` };
    }
    if (!isYearEnd(sourcePeriod)) {
      return { coherent: false, reason: `interim source ${sourcePeriod} cannot be presented as ${labelKind} "${labelPeriod}" (masquerading as a full year).` };
    }
    return { coherent: true, reason: `same-year year-end source ${sourcePeriod} backs ${labelKind} "${labelPeriod}".` };
  }

  // interim label
  if (labelYear !== null && srcYear !== labelYear) {
    return { coherent: false, reason: `interim label "${labelPeriod}" conflicts with source period ${sourcePeriod} (year ${srcYear} ≠ ${labelYear}).` };
  }
  return { coherent: true, reason: `interim source ${sourcePeriod} backs interim label "${labelPeriod}".` };
}

export function certifyGlobalCashFlow(
  rows: GcfRowInput[],
  opts?: { personalIncomeDependency?: GcfDependencyStatus },
): CertifiedGlobalCashFlow {
  const dependency: GcfDependencyStatus = opts?.personalIncomeDependency ?? "ok";
  const certifications: GcfCertification[] = [];
  const auditRows: CertifiedAuditRow[] = [];

  for (const row of rows) {
    // Lifecycle filter.
    const selectable = row.sources.filter(
      (s) =>
        s.is_superseded !== true &&
        !NON_SELECTABLE_STATUSES.has((s.resolution_status ?? "").toLowerCase()) &&
        s.value !== null,
    );

    const mk = (
      value: CertifiedSpreadValue,
      preliminary: boolean,
      winner: GcfSourceFact | null,
      dependencyStatus: GcfDependencyStatus,
      rejected: GcfRejected[],
      reason: string,
    ): GcfCertification => ({
      row: row.row,
      value,
      preliminary,
      labelPeriod: row.labelPeriod,
      labelKind: row.labelKind,
      sourcePeriod: winner?.sourcePeriod ?? null,
      sourceFamily: winner ? sourceFamily(winner) : null,
      ownerContext: winner ? winner.ownerEntityId ?? winner.ownerType : null,
      dependencyStatus,
      rejected,
      reason,
    });

    if (selectable.length === 0) {
      const value = certifiedUnavailable(`${row.row}: no selectable source (all superseded/rejected/system_invalidated/null).`);
      const cert = mk(value, false, null, dependency, [], value.failureReason!);
      certifications.push(cert);
      auditRows.push(auditRowFromValue("global_cash_flow", row.row, row.labelPeriod, value));
      continue;
    }

    // Partition by period coherence with the label.
    const rejected: GcfRejected[] = [];
    const coherent: GcfSourceFact[] = [];
    const conflicting: { s: GcfSourceFact; reason: string }[] = [];
    for (const s of selectable) {
      const ev = evaluatePeriod(row.labelPeriod, row.labelKind, s.sourcePeriod);
      if (ev.coherent) coherent.push(s);
      else conflicting.push({ s, reason: ev.reason });
    }

    const byConfidence = (a: GcfSourceFact, b: GcfSourceFact) =>
      (b.confidence ?? 0) - (a.confidence ?? 0) || (a.id ?? "").localeCompare(b.id ?? "");

    if (coherent.length === 0) {
      // Every source's period conflicts with the label → block (the "Tax Year 2022" + interim case).
      const rep = [...selectable].sort(byConfidence)[0];
      for (const c of conflicting) {
        rejected.push({ factId: c.s.id, value: c.s.value, sourcePeriod: c.s.sourcePeriod, sourceFamily: sourceFamily(c.s), reason: c.reason });
      }
      const repReason = conflicting.find((c) => c.s === rep)?.reason ?? "source period conflicts with label.";
      const value = certifiedBlocked(`${row.row}: ${repReason}`);
      const cert = mk(value, false, rep, dependency, rejected, repReason);
      certifications.push(cert);
      auditRows.push(auditRowFromValue("global_cash_flow", row.row, row.labelPeriod, value));
      continue;
    }

    const winner = [...coherent].sort(byConfidence)[0];
    for (const s of selectable) {
      if (s === winner) continue;
      const ev = evaluatePeriod(row.labelPeriod, row.labelKind, s.sourcePeriod);
      rejected.push({
        factId: s.id,
        value: s.value,
        sourcePeriod: s.sourcePeriod,
        sourceFamily: sourceFamily(s),
        reason: ev.coherent ? `lost to a higher-confidence coherent source.` : ev.reason,
      });
    }

    const trace = {
      factId: winner.id,
      factKey: winner.factKey,
      documentId: winner.documentId,
      canonicalType: winner.canonicalType,
      confidence: winner.confidence,
    };

    // Period is coherent — now apply the personal-income dependency gate.
    const dependsOnPI = row.dependsOnPersonalIncome === true;
    if (dependsOnPI && dependency === "blocked") {
      const value = certifiedBlocked(
        `${row.row}: depends on personal income that is blocked — GCF cannot be certified from blocked personal inputs.`,
      );
      const cert = mk(value, false, winner, dependency, rejected, value.failureReason!);
      certifications.push(cert);
      auditRows.push(auditRowFromValue("global_cash_flow", row.row, row.labelPeriod, value));
      continue;
    }

    if (dependsOnPI && dependency === "preliminary") {
      const value = certifiedDirectFact(winner.value, trace, [
        "Preliminary — depends on personal income that is not finalized; not a clean GCF certification.",
      ]);
      const cert = mk(value, true, winner, dependency, rejected, `Certified PRELIMINARY (personal income preliminary); ${evaluatePeriod(row.labelPeriod, row.labelKind, winner.sourcePeriod).reason}`);
      certifications.push(cert);
      auditRows.push(auditRowFromValue("global_cash_flow", row.row, row.labelPeriod, value));
      continue;
    }

    const value = certifiedDirectFact(winner.value, trace);
    const cert = mk(value, false, winner, dependency, rejected, evaluatePeriod(row.labelPeriod, row.labelKind, winner.sourcePeriod).reason);
    certifications.push(cert);
    auditRows.push(auditRowFromValue("global_cash_flow", row.row, row.labelPeriod, value));
  }

  return { certifications, auditRows };
}

/** Look up the certification for a GCF row by name. */
export function getGcfCertification(
  result: CertifiedGlobalCashFlow,
  row: string,
): GcfCertification | null {
  return result.certifications.find((c) => c.row === row) ?? null;
}
