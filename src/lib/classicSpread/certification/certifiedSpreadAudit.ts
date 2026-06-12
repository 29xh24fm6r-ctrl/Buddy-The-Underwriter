/**
 * SPEC-CLASSIC-SPREAD-CERTIFIED-NUMBER-SOURCES-1 (Phase 1)
 *
 * Per-displayed-value audit. Every number the spread intends to show produces one audit row
 * recording where it came from and whether it passed certification. The summary is what
 * SPEC-...-CERTIFICATION-GATE-1 (Phase 6) will persist into rendered_json and gate the PDF on.
 * Pure — no DB, no IO.
 */

import type {
  CertifiedSpreadValue,
  CertifiedStatus,
  CertifiedSourceType,
} from "./certifiedSpreadValue";

export type CertifiedAuditRow = {
  page: string;
  row: string;
  period: string;
  displayedValue: number | null;
  status: CertifiedStatus;
  sourceType: CertifiedSourceType;
  sourceFactIds: string[];
  sourceFactKeys: string[];
  sourceDocumentIds: string[];
  sourceCanonicalTypes: string[];
  formulaName: string | null;
  pass: boolean;
  failureReason: string | null;
};

export type CertificationStatus = "clean" | "caveated" | "blocked";

export type CertifiedSpreadAudit = {
  rows: CertifiedAuditRow[];
  certificationStatus: CertificationStatus;
  blockedValueCount: number;
  unavailableValueCount: number;
  sourceFactCount: number;
  caveats: string[];
};

/** Build one audit row from a certified value at a (page, row, period) coordinate. */
export function auditRowFromValue(
  page: string,
  row: string,
  period: string,
  v: CertifiedSpreadValue,
): CertifiedAuditRow {
  return {
    page,
    row,
    period,
    displayedValue: v.status === "certified" ? v.value : null,
    status: v.status,
    sourceType: v.sourceType,
    sourceFactIds: v.sourceFactIds,
    sourceFactKeys: v.sourceFactKeys,
    sourceDocumentIds: v.sourceDocumentIds,
    sourceCanonicalTypes: v.sourceCanonicalTypes,
    formulaName: v.formulaName,
    pass: v.status === "certified",
    failureReason: v.failureReason,
  };
}

/** Roll per-value audit rows into a summary for the gate + rendered_json. */
export function summarizeAudit(rows: CertifiedAuditRow[], caveats: string[] = []): CertifiedSpreadAudit {
  const blockedValueCount = rows.filter((r) => r.status === "blocked").length;
  const unavailableValueCount = rows.filter((r) => r.status === "unavailable").length;
  const sourceFactCount = new Set(rows.flatMap((r) => r.sourceFactIds)).size;

  // blocked dominates (a false number was suppressed); caveats/unavailable → caveated; else clean.
  const certificationStatus: CertificationStatus =
    blockedValueCount > 0
      ? "blocked"
      : unavailableValueCount > 0 || caveats.length > 0
        ? "caveated"
        : "clean";

  return {
    rows,
    certificationStatus,
    blockedValueCount,
    unavailableValueCount,
    sourceFactCount,
    caveats: [...new Set(caveats)],
  };
}
