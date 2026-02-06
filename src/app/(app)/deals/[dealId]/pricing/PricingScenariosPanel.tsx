"use client";

import { useState, useEffect, useCallback } from "react";

type Scenario = {
  id: string;
  scenario_key: string;
  product_type: string;
  structure: any;
  metrics: any;
  policy_overlays: any[];
  created_at: string;
};

type Decision = {
  id: string;
  decision: string;
  rationale: string;
  risks: any[];
  mitigants: any[];
  pricing_scenario_id: string;
  decided_at: string;
  decided_by: string;
  pricing_terms: any[];
};

type Props = {
  dealId: string;
};

function fmt$(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 1) return `${(v * 100).toFixed(1)}%`;
  return `${v.toFixed(2)}%`;
}

function fmtX(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}x`;
}

const SCENARIO_LABELS: Record<string, string> = {
  BASE: "Base Case",
  CONSERVATIVE: "Conservative",
  STRETCH: "Stretch",
  SBA_7A: "SBA 7(a)",
};

const DECISION_COLORS: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  REJECTED: "bg-red-100 text-red-800 border-red-300",
  RESTRUCTURE: "bg-amber-100 text-amber-800 border-amber-300",
};

export default function PricingScenariosPanel({ dealId }: Props) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Decision form state
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [decisionType, setDecisionType] = useState<"APPROVED" | "REJECTED" | "RESTRUCTURE">("APPROVED");
  const [rationale, setRationale] = useState("");
  const [showDecisionForm, setShowDecisionForm] = useState(false);

  const loadScenarios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/pricing/scenarios`);
      const data = await res.json();
      if (data.ok) {
        setScenarios(data.scenarios ?? []);
        setDecision(data.decision ?? null);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/pricing/scenarios/generate`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === "no_financial_snapshot"
          ? "Financial snapshot required — generate spreads and snapshot first."
          : data.error === "spreads_still_generating"
            ? "Spreads are still generating. Please wait and try again."
            : data.error === "no_loan_request"
              ? "A loan request is required before generating pricing scenarios."
              : `Generation failed: ${data.error}`);
        return;
      }
      setSuccess(`Generated ${data.scenarios?.length ?? 0} pricing scenarios.`);
      await loadScenarios();
    } catch {
      setError("Network error generating scenarios.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDecide() {
    if (!selectedScenarioId || !rationale.trim()) return;
    setDeciding(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/pricing/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pricing_scenario_id: selectedScenarioId,
          decision: decisionType,
          rationale: rationale.trim(),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(`Decision failed: ${data.error}`);
        return;
      }
      setSuccess("Pricing decision recorded. Pipeline cleared.");
      setShowDecisionForm(false);
      await loadScenarios();
    } catch {
      setError("Network error recording decision.");
    } finally {
      setDeciding(false);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Pricing Decision System</h2>
        <div className="flex gap-2">
          {decision && (
            <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${DECISION_COLORS[decision.decision] ?? "bg-gray-100"}`}>
              {decision.decision}
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? "Generating..." : scenarios.length ? "Regenerate Scenarios" : "Generate Pricing Scenarios"}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">
          {success}
        </div>
      )}

      {/* Pipeline status */}
      {!decision && scenarios.length > 0 && (
        <div className="p-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg flex items-center gap-2">
          <span className="font-semibold">PRICING_REQUIRED</span>
          <span>— Select a scenario and approve to clear the pipeline gate.</span>
        </div>
      )}

      {decision && (
        <div className="p-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg">
          <span className="font-semibold">Pipeline cleared</span> — Pricing decision: {decision.decision} on {new Date(decision.decided_at).toLocaleDateString()}.
          Rationale: {decision.rationale}
        </div>
      )}

      {/* Scenario Comparison Table */}
      {scenarios.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-600 w-48">Metric</th>
                {scenarios.map((s) => (
                  <th key={s.id} className={`px-4 py-3 text-center font-semibold ${decision?.pricing_scenario_id === s.id ? "bg-indigo-50 text-indigo-800" : "text-slate-700"}`}>
                    <div>{SCENARIO_LABELS[s.scenario_key] ?? s.scenario_key}</div>
                    <div className="text-xs font-normal text-slate-500">{s.product_type}</div>
                    {decision?.pricing_scenario_id === s.id && (
                      <span className="mt-1 inline-block px-2 py-0.5 text-xs font-semibold bg-indigo-600 text-white rounded-full">Selected</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <MetricRow label="All-In Rate" scenarios={scenarios} getValue={(s) => fmtPct(s.structure?.all_in_rate_pct)} decision={decision} />
              <MetricRow label="Index + Spread" scenarios={scenarios} getValue={(s) => `${s.structure?.index_code ?? ""} + ${s.structure?.spread_bps ?? "—"}bps`} decision={decision} />
              <MetricRow label="Loan Amount" scenarios={scenarios} getValue={(s) => fmt$(s.structure?.loan_amount)} decision={decision} />
              <MetricRow label="Term" scenarios={scenarios} getValue={(s) => `${s.structure?.term_months ?? "—"} mo`} decision={decision} />
              <MetricRow label="Amortization" scenarios={scenarios} getValue={(s) => `${s.structure?.amort_months ?? "—"} mo`} decision={decision} />
              <MetricRow label="DSCR" scenarios={scenarios} getValue={(s) => fmtX(s.metrics?.dscr)} highlight={(s) => (s.metrics?.dscr != null && s.metrics.dscr < 1.25) ? "text-red-600 font-semibold" : ""} decision={decision} />
              <MetricRow label="Stressed DSCR (+300bps)" scenarios={scenarios} getValue={(s) => fmtX(s.metrics?.dscr_stressed_300bps)} highlight={(s) => (s.metrics?.dscr_stressed_300bps != null && s.metrics.dscr_stressed_300bps < 1.0) ? "text-red-600 font-semibold" : ""} decision={decision} />
              <MetricRow label="LTV" scenarios={scenarios} getValue={(s) => fmtPct(s.metrics?.ltv_pct)} highlight={(s) => (s.metrics?.ltv_pct != null && s.metrics.ltv_pct > 0.8) ? "text-red-600 font-semibold" : ""} decision={decision} />
              <MetricRow label="Debt Yield" scenarios={scenarios} getValue={(s) => fmtPct(s.metrics?.debt_yield_pct)} decision={decision} />
              <MetricRow label="Annual Debt Service" scenarios={scenarios} getValue={(s) => fmt$(s.metrics?.annual_debt_service)} decision={decision} />
              <MetricRow label="Monthly P&I" scenarios={scenarios} getValue={(s) => fmt$(s.metrics?.monthly_pi)} decision={decision} />
              <MetricRow label="Guaranty" scenarios={scenarios} getValue={(s) => s.structure?.guaranty ?? "—"} decision={decision} />
              <MetricRow label="Origination Fee" scenarios={scenarios} getValue={(s) => `${s.structure?.fees?.origination_pct ?? "—"}%`} decision={decision} />
              {/* Policy overlays */}
              <tr className="bg-slate-50">
                <td className="px-4 py-2 font-semibold text-slate-600">Policy Overlays</td>
                {scenarios.map((s) => (
                  <td key={s.id} className={`px-4 py-2 text-xs text-left ${decision?.pricing_scenario_id === s.id ? "bg-indigo-50" : ""}`}>
                    {(s.policy_overlays ?? []).length > 0 ? (
                      <ul className="space-y-1">
                        {(s.policy_overlays ?? []).map((o: any, i: number) => (
                          <li key={i} className="text-slate-600">
                            <span className="font-medium">{o.source}</span>: {o.rule}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-emerald-600">All clear</span>
                    )}
                  </td>
                ))}
              </tr>
              {/* Select row */}
              {!decision && (
                <tr>
                  <td className="px-4 py-3 font-semibold text-slate-600">Action</td>
                  {scenarios.map((s) => (
                    <td key={s.id} className="px-4 py-3 text-center">
                      <button
                        onClick={() => {
                          setSelectedScenarioId(s.id);
                          setShowDecisionForm(true);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                      >
                        Select & Approve
                      </button>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Decision Form */}
      {showDecisionForm && selectedScenarioId && (
        <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="text-base font-semibold text-slate-900">Record Pricing Decision</h3>
          <p className="text-sm text-slate-600">
            Scenario: <span className="font-semibold">
              {SCENARIO_LABELS[scenarios.find((s) => s.id === selectedScenarioId)?.scenario_key ?? ""] ?? "Selected"}
            </span>
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Decision</label>
            <div className="flex gap-2">
              {(["APPROVED", "REJECTED", "RESTRUCTURE"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDecisionType(d)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                    decisionType === d
                      ? DECISION_COLORS[d]
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Rationale <span className="text-slate-400">(required, min 10 characters)</span>
            </label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Explain the pricing decision rationale for credit committee review..."
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDecide}
              disabled={deciding || rationale.trim().length < 10}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deciding ? "Recording..." : "Confirm Decision"}
            </button>
            <button
              onClick={() => setShowDecisionForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && scenarios.length === 0 && (
        <div className="py-8 text-center text-sm text-slate-500">
          Loading pricing scenarios...
        </div>
      )}

      {!loading && scenarios.length === 0 && (
        <div className="py-8 text-center text-sm text-slate-500">
          No pricing scenarios generated yet. Click &ldquo;Generate Pricing Scenarios&rdquo; to begin.
        </div>
      )}
    </div>
  );
}

function MetricRow({
  label,
  scenarios,
  getValue,
  highlight,
  decision,
}: {
  label: string;
  scenarios: Scenario[];
  getValue: (s: Scenario) => string;
  highlight?: (s: Scenario) => string;
  decision: Decision | null;
}) {
  return (
    <tr>
      <td className="px-4 py-2 text-slate-600 font-medium">{label}</td>
      {scenarios.map((s) => (
        <td
          key={s.id}
          className={`px-4 py-2 text-center tabular-nums ${highlight?.(s) ?? ""} ${decision?.pricing_scenario_id === s.id ? "bg-indigo-50" : ""}`}
        >
          {getValue(s)}
        </td>
      ))}
    </tr>
  );
}
