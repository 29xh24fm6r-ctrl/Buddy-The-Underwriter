/**
 * SPEC-FINENGINE-COMPLETE-BUILD-1 Workstream B — multi-deal spread regression.
 *
 * Runs computeDealSpread + validateSpread (selection-layer guard + decision-metric
 * goldens + anchors) across a set of deals and fails on ANY UNEXPECTED divergence
 * that isn't a registered INTENDED. Wired into `guard:all` as a blocking merge
 * gate so a change that silently breaks a deal's spread can't reach main. Pure —
 * no DB; the CI gate runs the committed fixture deals.
 */

import { computeDealSpread } from "@/lib/finengine/spread/dealSpread";
import { validateSpread, type IntendedDivergence, type HardAnchor } from "@/lib/finengine/spread/validateSpread";
import type { CertifiedFactRow, EntityScope } from "@/lib/finengine/shadow/dealInputAdapter";

export type RegressionDeal = { id: string; name: string; rows: CertifiedFactRow[]; intended?: IntendedDivergence[]; hardAnchors?: HardAnchor[]; scope?: EntityScope };

export type RegressionResult = {
  id: string;
  name: string;
  zero: number;
  intended: number;
  unexpected: number;
  cutoverBlocked: boolean;
  unexpectedDetails: string[];
};

export type RegressionReport = { results: RegressionResult[]; failed: boolean; totalUnexpected: number };

/** Run the spread regression over a deal set. `failed` is true if any deal has an UNEXPECTED. */
export function runSpreadRegression(deals: RegressionDeal[]): RegressionReport {
  const results: RegressionResult[] = deals.map((d) => {
    const spread = computeDealSpread(d.id, d.rows);
    const val = validateSpread(spread, { scope: d.scope ?? "BUSINESS", rawRows: d.rows, intended: d.intended, hardAnchors: d.hardAnchors });
    return {
      id: d.id,
      name: d.name,
      zero: val.zero,
      intended: val.intended,
      unexpected: val.unexpected,
      cutoverBlocked: val.cutoverBlocked,
      unexpectedDetails: val.checks
        .filter((c) => c.classification === "UNEXPECTED")
        .map((c) => `${c.metric}@${c.period}: engine=${c.engine} golden=${c.golden}`),
    };
  });
  const totalUnexpected = results.reduce((s, r) => s + r.unexpected, 0);
  return { results, failed: totalUnexpected > 0, totalUnexpected };
}

/** Format the report for the CI gate's console output. */
export function formatRegressionReport(report: RegressionReport): string {
  const lines = report.results.map(
    (r) => `  ${r.unexpected > 0 ? "✗" : "✓"} ${r.name} [${r.id}] — ZERO=${r.zero} INTENDED=${r.intended} UNEXPECTED=${r.unexpected}` +
      (r.unexpectedDetails.length ? `\n      ${r.unexpectedDetails.join("\n      ")}` : ""),
  );
  return lines.join("\n");
}
