// src/components/deals/ScenarioSensitivityCard.tsx
"use client";

import React, { useMemo } from "react";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import { DEFAULT_POLICY } from "@/lib/finance/underwriting/policy";
import { DEFAULT_SCENARIOS } from "@/lib/finance/underwriting/scenarios";
import { computeScenarioResults } from "@/lib/finance/underwriting/computeScenarioResults";

function fmtX(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(2)}x`;
}

function pill(level: string) {
  if (level === "approve") return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (level === "decline_risk") return "bg-red-50 border-red-200 text-red-800";
  return "bg-amber-50 border-amber-200 text-amber-800";
}

export default function ScenarioSensitivityCard({
  spreadsByYear,
  annualDebtService,
}: {
  spreadsByYear: Record<number, TaxSpread>;
  annualDebtService: number | null;
}) {
  const rows = useMemo(() => {
    return computeScenarioResults(spreadsByYear, annualDebtService, DEFAULT_POLICY, DEFAULT_SCENARIOS);
  }, [spreadsByYear, annualDebtService]);

  if (Object.keys(spreadsByYear).length < 2) return null;

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Scenario & Policy Sensitivity</div>
        <div className="text-xs text-muted-foreground">DSCR policy floor is scenario-specific</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="border-b p-2">Scenario</th>
              <th className="border-b p-2">Policy</th>
              <th className="border-b p-2">ADS Mult</th>
              <th className="border-b p-2">CFADS Haircut</th>
              <th className="border-b p-2">Worst DSCR</th>
              <th className="border-b p-2">Worst Year</th>
              <th className="border-b p-2">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.scenario.name}>
                <td className="border-b p-2 font-medium">{r.scenario.name}</td>
                <td className="border-b p-2">{r.scenario.policy_min_dscr.toFixed(2)}x</td>
                <td className="border-b p-2">{r.scenario.ads_multiplier.toFixed(2)}×</td>
                <td className="border-b p-2">{Math.round(r.scenario.cfads_haircut_pct * 100)}%</td>
                <td className="border-b p-2">{fmtX(r.worst_dscr)}</td>
                <td className="border-b p-2">{r.worst_year ?? "—"}</td>
                <td className="border-b p-2">
                  <span className={["inline-flex rounded-full border px-2 py-1 text-xs", pill(r.verdict_level)].join(" ")}>
                    {r.verdict_level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}