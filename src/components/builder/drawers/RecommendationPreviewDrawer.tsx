"use client";

import type { StructuringScenario } from "@/lib/structuring/types";

type Props = {
  open: boolean;
  onClose: () => void;
  scenario: StructuringScenario | null;
  currentValues: {
    loan_amount?: number;
    equity_pct?: number;
    equity_amount?: number;
    gross_collateral?: number;
    lendable_value?: number;
    ltv?: number | null;
    exception_count: number;
  };
  onApply?: (scenario: StructuringScenario) => void;
};

const glass = "rounded-xl border border-white/10 bg-white/[0.03] p-4";

export function RecommendationPreviewDrawer({ open, onClose, scenario, currentValues, onApply }: Props) {
  if (!open || !scenario) return null;

  const rows: Array<{ label: string; current: string; proposed: string; changed: boolean }> = [];

  // Loan Amount
  const currLoan = currentValues.loan_amount ?? 0;
  const projLoan = scenario.projected_loan_amount ?? currLoan;
  rows.push({
    label: "Loan Amount",
    current: `$${currLoan.toLocaleString()}`,
    proposed: `$${projLoan.toLocaleString()}`,
    changed: projLoan !== currLoan,
  });

  // Equity %
  const currEqPct = currentValues.equity_pct;
  const projEqPct = scenario.projected_equity_pct;
  if (currEqPct != null || projEqPct != null) {
    rows.push({
      label: "Equity %",
      current: currEqPct != null ? `${(currEqPct * 100).toFixed(0)}%` : "\u2014",
      proposed: projEqPct != null ? `${(projEqPct * 100).toFixed(0)}%` : "\u2014",
      changed: projEqPct != null && projEqPct !== currEqPct,
    });
  }

  // Lendable Value
  const currLendable = currentValues.lendable_value ?? 0;
  const projLendable = scenario.projected_lendable_value ?? currLendable;
  rows.push({
    label: "Lendable Value",
    current: `$${currLendable.toLocaleString()}`,
    proposed: `$${projLendable.toLocaleString()}`,
    changed: projLendable !== currLendable,
  });

  // LTV
  const currLtv = currentValues.ltv;
  const projLtv = scenario.projected_ltv;
  rows.push({
    label: "LTV",
    current: currLtv != null ? `${(currLtv * 100).toFixed(1)}%` : "\u2014",
    proposed: projLtv != null ? `${(projLtv * 100).toFixed(1)}%` : "\u2014",
    changed: projLtv != null && projLtv !== currLtv,
  });

  // Exception count
  const currExc = currentValues.exception_count;
  const projExc = scenario.remaining_exception_keys.length;
  rows.push({
    label: "Active Exceptions",
    current: String(currExc),
    proposed: String(projExc),
    changed: projExc !== currExc,
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-[min(92vw,520px)] h-full overflow-y-auto bg-[#0f1115] border-l border-white/10 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-white/50 mb-1">Recommendation Preview</div>
            <h2 className="text-base font-semibold text-white">{scenario.label}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Summary */}
        <div className="text-xs text-white/70">{scenario.summary}</div>

        {/* Current vs Proposed table */}
        <div className={glass}>
          <div className="text-xs font-semibold text-white/50 mb-3">Current vs Proposed</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40 border-b border-white/10">
                <th className="text-left py-1 pr-2">Metric</th>
                <th className="text-right py-1 px-2">Current</th>
                <th className="text-right py-1 px-2">Proposed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-white/5">
                  <td className="py-1.5 pr-2 text-white/60">{row.label}</td>
                  <td className="text-right py-1.5 px-2 text-white/50">{row.current}</td>
                  <td className={`text-right py-1.5 px-2 font-medium ${row.changed ? "text-emerald-300" : "text-white/50"}`}>
                    {row.proposed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions required */}
        {scenario.actions.length > 0 && (
          <div className={glass}>
            <div className="text-xs font-semibold text-white/50 mb-2">Actions Required</div>
            <ul className="space-y-1">
              {scenario.actions.map((action, i) => (
                <li key={i} className="text-xs text-white/70 flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">&#9679;</span>
                  {describeAction(action)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Exceptions impact */}
        <div className={glass}>
          <div className="text-xs font-semibold text-white/50 mb-2">Policy Impact</div>
          {scenario.resolves_exception_keys.length > 0 && (
            <div className="text-xs text-emerald-300/80 mb-1">
              Resolves: {scenario.resolves_exception_keys.join(", ")}
            </div>
          )}
          {scenario.remaining_exception_keys.length > 0 && (
            <div className="text-xs text-amber-300/80 mb-1">
              Remaining: {scenario.remaining_exception_keys.join(", ")}
            </div>
          )}
          {scenario.resolves_exception_keys.length === 0 && scenario.remaining_exception_keys.length === 0 && (
            <div className="text-xs text-white/40">No policy exceptions affected.</div>
          )}
        </div>

        {/* Tradeoffs */}
        {scenario.tradeoffs.length > 0 && (
          <div className={glass}>
            <div className="text-xs font-semibold text-white/50 mb-2">Tradeoffs</div>
            <ul className="space-y-1">
              {scenario.tradeoffs.map((t, i) => (
                <li key={i} className="text-xs text-white/50">&bull; {t}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Apply button */}
        {onApply && scenario.path_type !== "not_yet_ready" && (
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onApply(scenario); onClose(); }}
              className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-600/30"
            >
              Apply to Builder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function describeAction(action: StructuringScenario["actions"][number]): string {
  switch (action.kind) {
    case "set_loan_amount":
      return `Set loan amount to $${action.to.toLocaleString()}`;
    case "set_equity_pct":
      return `Set equity to ${(action.to * 100).toFixed(0)}%`;
    case "set_equity_amount":
      return `Set equity amount to $${action.to.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    case "require_additional_collateral":
      return `Add $${action.additional_lendable_value_needed.toLocaleString(undefined, { maximumFractionDigits: 0 })} lendable collateral`;
    case "require_valuation_upgrade":
      return `Obtain ${action.to_method_hint} for collateral`;
    case "proceed_with_exception":
      return `Document exceptions and proceed with committee review`;
    case "resolve_missing_input":
      return `Resolve: ${action.field_hint}`;
    default:
      return "Unknown action";
  }
}
