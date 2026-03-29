"use client";

import type { SBAPackageData } from "@/lib/sba/sbaReadinessTypes";
import DSCRAlertBanner from "./DSCRAlertBanner";

interface Props {
  dealId: string;
  pkg: SBAPackageData;
  generating: boolean;
  onRegenerate: () => void;
  onSubmit: () => void;
}

function dscrColor(val: number): string {
  if (val >= 1.25) return "text-emerald-400";
  if (val >= 1.0) return "text-amber-400";
  return "text-red-400";
}

function fmtCurrency(val: number): string {
  return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default function SBAPackageViewer({
  dealId,
  pkg,
  generating,
  onRegenerate,
  onSubmit,
}: Props) {
  const failingYears = [1, 2, 3].filter((y) => {
    const dscr = y === 1 ? pkg.dscrYear1Base : y === 2 ? pkg.dscrYear2Base : pkg.dscrYear3Base;
    return dscr < 1.25;
  });

  const lowestDscr = Math.min(pkg.dscrYear1Base, pkg.dscrYear2Base, pkg.dscrYear3Base);

  const breakEven = pkg.breakEven;

  return (
    <div className="space-y-4">
      {/* DSCR Alert Banner */}
      <DSCRAlertBanner
        dealId={dealId}
        dscrBelowThreshold={pkg.dscrBelowThreshold}
        failingYears={failingYears}
        lowestDscr={lowestDscr}
      />

      {/* DSCR Summary Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">DSCR Summary</h3>
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div />
          <div className="text-center text-white/50">Year 1</div>
          <div className="text-center text-white/50">Year 2</div>
          <div className="text-center text-white/50">Year 3</div>

          <div className="text-white/60">Base Case</div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear1Base)}`}>
            {pkg.dscrYear1Base.toFixed(2)}x
          </div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear2Base)}`}>
            {pkg.dscrYear2Base.toFixed(2)}x
          </div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear3Base)}`}>
            {pkg.dscrYear3Base.toFixed(2)}x
          </div>

          <div className="text-white/60">Downside Y1</div>
          <div className={`text-center font-mono font-semibold ${dscrColor(pkg.dscrYear1Downside)}`}>
            {pkg.dscrYear1Downside.toFixed(2)}x
          </div>
          <div />
          <div />
        </div>
        <div className="text-xs text-white/40">SBA minimum: 1.25x</div>
      </div>

      {/* Break-Even Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Break-Even Analysis</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-white/50">Break-Even Revenue</span>
            <div className="text-white font-mono">
              {fmtCurrency(breakEven.breakEvenRevenue)}
            </div>
          </div>
          <div>
            <span className="text-white/50">Projected Y1 Revenue</span>
            <div className="text-white font-mono">
              {fmtCurrency(breakEven.projectedRevenueYear1)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-white/50">Margin of Safety:</span>
          <span
            className={`font-mono font-semibold ${
              breakEven.flagLowMargin ? "text-amber-400" : "text-emerald-400"
            }`}
          >
            {(breakEven.marginOfSafetyPct * 100).toFixed(1)}%
          </span>
          {breakEven.flagLowMargin && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                warning
              </span>
              Below 10% margin of safety
            </span>
          )}
        </div>
      </div>

      {/* Sensitivity Table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Sensitivity Analysis</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/50 text-xs">
                <th className="text-left py-1 pr-3">Scenario</th>
                <th className="text-right py-1 px-2">Y1 Revenue</th>
                <th className="text-right py-1 px-2">EBITDA Margin</th>
                <th className="text-right py-1 px-2">DSCR Y1</th>
                <th className="text-right py-1 px-2">DSCR Y2</th>
                <th className="text-right py-1 px-2">DSCR Y3</th>
                <th className="text-right py-1 pl-2">SBA Threshold</th>
              </tr>
            </thead>
            <tbody>
              {pkg.sensitivityScenarios.map((s) => (
                <tr key={s.name} className="border-t border-white/5">
                  <td className="py-1.5 pr-3 text-white/80">{s.label}</td>
                  <td className="text-right py-1.5 px-2 font-mono text-white/70">
                    {fmtCurrency(s.revenueYear1)}
                  </td>
                  <td className="text-right py-1.5 px-2 font-mono text-white/70">
                    {(s.ebitdaMarginYear1 * 100).toFixed(1)}%
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono ${dscrColor(s.dscrYear1)}`}>
                    {s.dscrYear1.toFixed(2)}x
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono ${dscrColor(s.dscrYear2)}`}>
                    {s.dscrYear2.toFixed(2)}x
                  </td>
                  <td className={`text-right py-1.5 px-2 font-mono ${dscrColor(s.dscrYear3)}`}>
                    {s.dscrYear3.toFixed(2)}x
                  </td>
                  <td className="text-right py-1.5 pl-2">
                    {s.passesSBAThreshold ? (
                      <span className="text-emerald-400 text-xs">Pass</span>
                    ) : (
                      <span className="text-red-400 text-xs">Below 1.25x</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => {
            if (pkg.pdfUrl) {
              window.open(`/api/storage/${pkg.pdfUrl}`, "_blank");
            }
          }}
          disabled={!pkg.pdfUrl}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Download PDF
        </button>

        <button
          onClick={onRegenerate}
          disabled={generating}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 disabled:opacity-40"
        >
          {generating ? "Generating..." : "Re-generate"}
        </button>

        <button
          onClick={onSubmit}
          disabled={pkg.status === "submitted"}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pkg.status === "submitted" ? "Submitted" : "Mark as Submitted"}
        </button>
      </div>
    </div>
  );
}
