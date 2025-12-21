// src/components/deals/UnderwritingResultsCard.tsx
"use client";

import React, { useMemo } from "react";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { computeUnderwritingResults } from "@/lib/finance/underwriting/computeResults";
import { DEFAULT_POLICY } from "@/lib/finance/underwriting/policy";
import { generateUnderwritingNarrative } from "@/lib/finance/underwriting/narrative";
import { computeUnderwritingVerdict } from "@/lib/finance/underwriting/computeVerdict";
import { EvidenceChips } from "@/components/evidence/EvidenceChips";

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtX(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)}x`;
}

function badge(level: "green" | "amber" | "red") {
  if (level === "green") return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (level === "amber") return "bg-amber-50 border-amber-200 text-amber-800";
  return "bg-red-50 border-red-200 text-red-800";
}

function levelFromWorst(worst: number | null, min: number): "green" | "amber" | "red" {
  if (worst === null) return "amber";
  if (worst >= min) return "green";
  if (worst >= 1.0) return "amber";
  return "red";
}

export default function UnderwritingResultsCard({
  dealId,
  spreadsByYear,
  adsStr,
  setAdsStr,
  annualDebtService,
  selectedYear,
}: {
  dealId?: string;
  spreadsByYear: Record<number, TaxSpread>;
  adsStr: string;
  setAdsStr: (v: string) => void;
  annualDebtService: number | null;
  selectedYear: number | null;
}) {
  const res = useMemo(
    () => computeUnderwritingResults(spreadsByYear, annualDebtService, DEFAULT_POLICY),
    [spreadsByYear, annualDebtService]
  );

  const verdict = useMemo(() => computeUnderwritingVerdict(res), [res]);

  const lvl = levelFromWorst(res.worst_dscr, res.policy_min_dscr);

  if (!Object.keys(spreadsByYear).length) return null;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Underwriting Results</div>
        <div className="flex items-center gap-2">
          {dealId ? (
            <EvidenceChips
              dealId={dealId}
              scope="uw_copilot"
              label="Why Buddy flagged these?"
              limit={10}
            />
          ) : null}
          <div className={["rounded-full border px-2 py-1 text-xs", badge(lvl)].join(" ")}>
            Policy: {res.policy_min_dscr.toFixed(2)}x
          </div>
        </div>
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-3">
        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Annual Debt Service</div>
          <input
            value={adsStr}
            onChange={(e) => setAdsStr(e.target.value)}
            placeholder="e.g., 185000"
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          />
        </div>

        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Worst DSCR</div>
          <div className="text-sm font-semibold">
            {fmtX(res.worst_dscr)} {res.worst_year ? `• TY ${res.worst_year}` : ""}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            CFADS trend: {res.cfads_trend.toUpperCase()} • Revenue trend: {res.revenue_trend.toUpperCase()}
          </div>
        </div>

        <div className="rounded border p-3">
          <div className="text-xs text-muted-foreground">Stressed DSCR (CFADS -10%)</div>
          <div className="text-sm font-semibold">{fmtX(res.stressed_dscr)}</div>
          <div className="mt-1 text-xs text-muted-foreground">Avg DSCR: {fmtX(res.avg_dscr)} • Weighted: {fmtX(res.weighted_dscr)}</div>
        </div>
      </div>

      <div className="rounded border p-3">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-semibold">Underwriting Conclusion</div>
          <span className="rounded-full border px-2 py-1 text-xs">
            {verdict.level.toUpperCase()}
          </span>
        </div>

        <div className="text-sm font-medium">{verdict.headline}</div>

        {!!verdict.rationale.length && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {verdict.rationale.slice(0, 6).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}

        {!!verdict.key_drivers.length && (
          <div className="mt-3 text-sm">
            <div className="font-medium">Key drivers</div>
            <ul className="list-disc pl-5">
              {verdict.key_drivers.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}

        {!!verdict.mitigants.length && (
          <div className="mt-3 text-sm">
            <div className="font-medium">Mitigants / Structure considerations</div>
            <ul className="list-disc pl-5">
              {verdict.mitigants.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded border bg-gray-50 p-3 text-sm">
        <div className="mb-1 font-medium">Credit Summary</div>
        <p className="leading-relaxed">
          {generateUnderwritingNarrative(res)}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="border-b p-2">Year</th>
              <th className="border-b p-2">Revenue</th>
              <th className="border-b p-2">Officer Comp</th>
              <th className="border-b p-2">CFADS (Proxy)</th>
              <th className="border-b p-2">DSCR</th>
              <th className="border-b p-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {res.by_year
              .slice()
              .sort((a, b) => b.year - a.year)
              .map((r) => {
                const isSel = selectedYear !== null && r.year === selectedYear;
                return (
                  <tr key={r.year} className={isSel ? "bg-gray-50" : ""}>
                    <td className="border-b p-2 font-medium">TY {r.year}</td>
                    <td className="border-b p-2">{fmtMoney(r.revenue)}</td>
                    <td className="border-b p-2">{fmtMoney(r.officer_comp)}</td>
                    <td className="border-b p-2">{fmtMoney(r.cfads)}</td>
                    <td className="border-b p-2">{fmtX(r.dscr)}</td>
                    <td className="border-b p-2">{Math.round((r.confidence ?? 0) * 100)}%</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {!!res.low_confidence_years.length && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Low confidence years: {res.low_confidence_years.join(", ")} (verify line items)
        </div>
      )}

      {!!res.flags.length && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          <div className="font-medium">Flags</div>
          <ul className="list-disc pl-4">
            {res.flags.slice(0, 10).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}