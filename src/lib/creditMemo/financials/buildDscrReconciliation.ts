/**
 * DSCR Reconciliation Block
 *
 * Explains why the UW DSCR may differ from period-table DSCRs and
 * shows the calculation behind the selected UW DSCR.
 *
 * Pure function — no DB, no server-only.
 */

export type DscrReconciliation = {
  underwriting_dscr: number | null;
  underwriting_cfads: number | null;
  underwriting_ads: number | null;
  calculation: string;
  source: string;
  period_dscrs: Array<{ period: string; dscr: number | null }>;
  reconciliation_note: string | null;
  warnings: string[];
};

function fmt$(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}MM`;
  if (val >= 1_000) return `$${Math.round(val).toLocaleString()}`;
  return `$${val.toFixed(0)}`;
}

export function buildDscrReconciliation(args: {
  uwDscr: number | null;
  cfads: number | null;
  ads: number | null;
  dscrSource: string;
  periodTable: Array<{ period_end: string; dscr: number | null }>;
}): DscrReconciliation {
  const { uwDscr, cfads, ads, dscrSource, periodTable } = args;
  const warnings: string[] = [];

  // Build calculation string
  let calculation = "Not computed";
  if (cfads !== null && ads !== null && ads > 0) {
    const computed = cfads / ads;
    calculation = `${fmt$(cfads)} / ${fmt$(ads)} = ${computed.toFixed(2)}x`;
  } else if (uwDscr !== null) {
    calculation = `${uwDscr.toFixed(2)}x (source: ${dscrSource})`;
  }

  // Extract period DSCRs
  const periodDscrs = periodTable
    .filter((r) => r.dscr !== null)
    .map((r) => ({ period: r.period_end, dscr: r.dscr }));

  // Check for material mismatch
  let reconciliationNote: string | null = null;
  if (uwDscr !== null && periodDscrs.length > 0) {
    const periodValues = periodDscrs.filter((p) => p.dscr !== null).map((p) => p.dscr!);
    const maxPeriod = Math.max(...periodValues);
    const minPeriod = Math.min(...periodValues);

    if (Math.abs(uwDscr - maxPeriod) > 1.0 || Math.abs(uwDscr - minPeriod) > 2.0) {
      reconciliationNote = `UW DSCR of ${uwDscr.toFixed(2)}x is based on normalized CFADS${cfads !== null ? ` of ${fmt$(cfads)}` : ""} divided by proposed annual debt service${ads !== null ? ` of ${fmt$(ads)}` : ""}. Period-table DSCRs (${periodValues.map((v) => v.toFixed(2) + "x").join(", ")}) reflect reported period cash flow and are shown for trend analysis; Buddy uses normalized CFADS for underwriting repayment capacity.`;
    }

    if (uwDscr > maxPeriod * 2) {
      warnings.push(`UW DSCR ${uwDscr.toFixed(2)}x is materially higher than best period DSCR ${maxPeriod.toFixed(2)}x — verify CFADS source and normalization.`);
    }
  }

  return {
    underwriting_dscr: uwDscr,
    underwriting_cfads: cfads,
    underwriting_ads: ads,
    calculation,
    source: dscrSource,
    period_dscrs: periodDscrs,
    reconciliation_note: reconciliationNote,
    warnings,
  };
}
