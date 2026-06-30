"use client";

import { useFinengineSpread } from "@/hooks/useFinengineSpread";
import type { PanelCell } from "@/lib/finengine/spread/balanceSheetPanelMetrics";

/**
 * SPEC-FINENGINE-BALANCE-SHEET-PANEL-1 §3 — Panel F: "Balance-Sheet Analysis — Finengine".
 *
 * The net-new balance-sheet ratio universe (cash/quick ratio, working capital, the
 * leverage/solvency block, the turnover family, fixed-asset age, net-worth
 * reconciliation, Altman Z, returns) sourced ONLY from `computeDealSpread` via the
 * gated route. Renders NOTHING when the route is disabled (dark by default) — no
 * layout shift, no "coming soon". Reads only the finengine hook; never `useSpreadOutput`
 * (one-engine firewall). Additive: it sits BELOW Panels A–E and touches none of them.
 */

const RATING_COLOR: Record<string, string> = {
  strong: "text-emerald-400",
  adequate: "text-white/80",
  weak: "text-amber-400",
  flag: "text-rose-400",
  "n/a": "text-white/40",
};

function fmtValue(metric: string, value: number): string {
  if (!isFinite(value)) return "—";
  // Days metrics → integer days; net-worth / NWC dollar figures → $; everything else → ratio.
  if (metric === "DSO" || metric === "DIO" || metric === "DPO" || metric === "FIXED_ASSET_AGE") return `${Math.round(value)}`;
  if (metric === "NET_WORKING_CAPITAL" || metric === "TANGIBLE_NET_WORTH" || metric === "EFFECTIVE_TANGIBLE_NET_WORTH" || metric === "NET_WORTH_RECONCILIATION") {
    const abs = Math.abs(value);
    const sign = value < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000).toLocaleString("en-US")}K`;
    return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  }
  if (metric === "WC_TO_SALES" || metric === "LIABILITIES_TO_ASSETS" || metric === "EQUITY_RATIO" || metric === "NET_TO_GROSS_PPE") {
    return Math.abs(value) <= 1.5 ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
  }
  return `${value.toFixed(2)}x`;
}

function PanelRatioCell({ cell }: { cell: PanelCell }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 flex flex-col gap-0.5" title={cell.interpretation}>
      <span className="text-[10px] uppercase tracking-wide text-white/50">{cell.label}</span>
      <span className={`font-semibold text-lg leading-tight ${RATING_COLOR[cell.rating] ?? "text-white"}`}>
        {fmtValue(cell.metric, cell.value)}
      </span>
    </div>
  );
}

export default function FinengineBalanceSheetPanel({ dealId }: { dealId: string }) {
  const { data } = useFinengineSpread(dealId);

  // Dark by default: render nothing unless the route enabled the panel with groups.
  if (!data || !data.enabled || data.groups.length === 0) return null;

  return (
    <div className="space-y-4 pt-2 border-t border-white/5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-white">Balance-Sheet Analysis</h3>
        <span className="text-[9px] uppercase tracking-wider text-cyan-300/80 border border-cyan-300/30 rounded px-1.5 py-0.5">finengine</span>
        {data.period && <span className="text-[10px] text-white/40">as of {data.period}</span>}
      </div>
      {data.groups.map((group) => (
        <div key={group.family} className="space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-white/40">{group.family}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {group.cells.map((cell) => (
              <PanelRatioCell key={cell.metric} cell={cell} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
