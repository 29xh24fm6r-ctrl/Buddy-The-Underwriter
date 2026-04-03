"use client";

import { useState, useEffect } from "react";

type ReadinessMeta = {
  status: "pending" | "partial" | "ready" | "error";
  last_generated_at: string | null;
  missing_spreads: string[];
  missing_metrics: string[];
};

type Props = {
  dealId: string;
  readiness: ReadinessMeta;
  dataCoverage: {
    deal: { total: number; populated: number; status: string };
    personal: { total: number; populated: number; status: string };
    global: { total: number; populated: number; status: string };
  };
  hints: {
    bankLoanTotal: number | null;
    cashFlowAvailable: number | null;
    annualDebtService: number | null;
  };
};

const FIELD_DEFS = [
  { key: "COLLATERAL.GROSS_VALUE",       label: "Appraised Value (Gross)",      group: "Collateral",          prefix: "$", hint: "As-is appraised value from appraisal report" },
  { key: "COLLATERAL.NET_VALUE",         label: "Net Collateral Value",         group: "Collateral",          prefix: "$", hint: "Gross × advance rate (e.g. 80%)" },
  { key: "COLLATERAL.DISCOUNTED_VALUE",  label: "Discounted Collateral Value",  group: "Collateral",          prefix: "$", hint: "Gross × discount rate (e.g. 60%)" },
  { key: "SOURCES_USES.TOTAL_PROJECT_COST", label: "Total Project Cost",        group: "Sources & Uses",      prefix: "$", hint: "Total acquisition + renovation + closing costs" },
  { key: "SOURCES_USES.BORROWER_EQUITY",    label: "Borrower Equity (Cash In)", group: "Sources & Uses",      prefix: "$", hint: "Cash equity injected by borrower" },
  { key: "SOURCES_USES.BANK_LOAN_TOTAL",    label: "Bank Loan Total",           group: "Sources & Uses",      prefix: "$", hint: "Total loan amount from this bank" },
  { key: "FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE", label: "Cash Flow Available / NOI", group: "Financial Analysis", prefix: "$", hint: "Net operating income or stabilized cash flow" },
  { key: "FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE", label: "Annual Debt Service",        group: "Financial Analysis", prefix: "$", hint: "Total annual P&I on all proposed debt" },
] as const;

type FieldKey = typeof FIELD_DEFS[number]["key"];

function fmt$(v: number | null) {
  if (v === null) return "—";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function parseNum(s: string): number | null {
  const clean = s.replace(/[$,\s]/g, "");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function computedMetrics(values: Partial<Record<FieldKey, string>>) {
  const cfa = parseNum(values["FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE"] ?? "");
  const ads = parseNum(values["FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE"] ?? "");
  const gross = parseNum(values["COLLATERAL.GROSS_VALUE"] ?? "");
  const loan = parseNum(values["SOURCES_USES.BANK_LOAN_TOTAL"] ?? "");
  const equity = parseNum(values["SOURCES_USES.BORROWER_EQUITY"] ?? "");
  const cost = parseNum(values["SOURCES_USES.TOTAL_PROJECT_COST"] ?? "");

  return {
    dscr: cfa !== null && ads !== null && ads > 0 ? (cfa / ads).toFixed(2) + "x" : null,
    dscrStressed: cfa !== null && ads !== null && ads > 0 ? (cfa / (ads * 1.03)).toFixed(2) + "x (stressed)" : null,
    excessCF: cfa !== null && ads !== null ? fmt$(cfa - ads) : null,
    ltvGross: loan !== null && gross !== null && gross > 0 ? ((loan / gross) * 100).toFixed(1) + "%" : null,
    equityPct: equity !== null && cost !== null && cost > 0 ? ((equity / cost) * 100).toFixed(1) + "%" : null,
    netSuggested: gross !== null ? fmt$(Math.round(gross * 0.8)) : null,
    discountedSuggested: gross !== null ? fmt$(Math.round(gross * 0.6)) : null,
  };
}

export default function MemoDataEntryCard({ dealId, readiness, dataCoverage, hints }: Props) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues((prev) => {
      const next = { ...prev };
      if (!next["SOURCES_USES.BANK_LOAN_TOTAL"] && hints.bankLoanTotal) {
        next["SOURCES_USES.BANK_LOAN_TOTAL"] = String(hints.bankLoanTotal);
      }
      if (!next["FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE"] && hints.cashFlowAvailable) {
        next["FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE"] = String(hints.cashFlowAvailable);
      }
      if (!next["FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE"] && hints.annualDebtService) {
        next["FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE"] = String(hints.annualDebtService);
      }
      return next;
    });
  }, [open, hints]);

  const computed = computedMetrics(values);

  const hasAnyValue = Object.values(values).some(v => v && parseNum(v) !== null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const facts: Array<{ factType: string; factKey: string; value: number }> = [];
      for (const [compositeKey, rawVal] of Object.entries(values)) {
        const num = parseNum(rawVal ?? "");
        if (num === null) continue;
        const [factType, factKey] = compositeKey.split(".");
        facts.push({ factType, factKey, value: num });
      }
      if (facts.length === 0) return;

      const res = await fetch(`/api/deals/${dealId}/credit-memo/facts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Save failed");
      }

      setSaved(true);
      setTimeout(() => {
        setOpen(false);
        window.location.reload();
      }, 700);
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const readinessColor =
    readiness.status === "ready" ? "bg-emerald-600" :
    readiness.status === "partial" ? "bg-amber-500" :
    readiness.status === "error" ? "bg-rose-600" :
    "bg-slate-400";

  const readinessPct =
    readiness.status === "ready" ? "100%" :
    readiness.status === "partial" ? "66%" :
    readiness.status === "error" ? "100%" : "33%";

  const missingCount = readiness.missing_metrics.length;

  return (
    <>
      {/* Readiness Card — clickable */}
      <div
        className={`mb-4 border border-gray-200 rounded-md p-3 transition-colors ${missingCount > 0 ? "cursor-pointer hover:border-gray-300 hover:bg-gray-50 group" : ""}`}
        onClick={() => missingCount > 0 && setOpen(true)}
        role={missingCount > 0 ? "button" : undefined}
        tabIndex={missingCount > 0 ? 0 : undefined}
        onKeyDown={e => e.key === "Enter" && missingCount > 0 && setOpen(true)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase text-gray-600">Memo Readiness</div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-500">Last data: {readiness.last_generated_at ?? "—"}</div>
            {missingCount > 0 && (
              <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 group-hover:bg-amber-100 transition-colors">
                Fill in {missingCount} missing field{missingCount !== 1 ? "s" : ""} &rarr;
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-gray-200 overflow-hidden">
            <div className={`h-2 ${readinessColor} transition-all`} style={{ width: readinessPct }} />
          </div>
          <div className="text-xs font-semibold text-gray-800 capitalize">{readiness.status}</div>
        </div>
        {readiness.missing_metrics.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Missing: {readiness.missing_metrics.join(", ")}
          </div>
        )}
      </div>

      {/* Data Coverage */}
      <div className="mb-4 flex items-center gap-3 text-xs">
        <span className="font-semibold text-gray-600 uppercase">Data Coverage:</span>
        {(["deal", "personal", "global"] as const).map((tier) => {
          const c = dataCoverage[tier];
          const icon = c.status === "complete" ? "\u2705" : c.status === "partial" ? "\u26A0\uFE0F" : "\u274C";
          return (
            <span key={tier} className="inline-flex items-center gap-1">
              <span>{icon}</span>
              <span className="capitalize">{tier}</span>
              <span className="text-gray-400">({c.populated}/{c.total})</span>
            </span>
          );
        })}
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col"
            style={{ maxHeight: "calc(100vh - 2rem)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 flex-shrink-0">
              <div>
                <div className="text-sm font-bold text-gray-900">Fill In Missing Metrics</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Enter values to complete the credit memo &mdash; derived metrics calculate automatically
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none ml-4">&times;</button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto px-6 py-4 flex-1">
              {(["Collateral", "Sources & Uses", "Financial Analysis"] as const).map(group => {
                const fields = FIELD_DEFS.filter(f => f.group === group);
                return (
                  <div key={group} className="mb-5">
                    <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3 pb-1 border-b border-gray-100">
                      {group}
                    </div>
                    <div className="space-y-3">
                      {fields.map(field => (
                        <div key={field.key}>
                          <label className="block text-xs font-medium text-gray-700 mb-0.5">
                            {field.label}
                          </label>
                          <p className="text-[11px] text-gray-400 mb-1">{field.hint}</p>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{field.prefix}</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={values[field.key] ?? ""}
                              onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                              placeholder="0"
                              className="w-full text-sm border border-gray-300 rounded-md pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-400"
                              style={{ color: "#111827", backgroundColor: "#ffffff" }}
                            />
                          </div>
                          {field.key === "COLLATERAL.NET_VALUE" && computed.netSuggested && !values["COLLATERAL.NET_VALUE"] && (
                            <button
                              className="text-[11px] text-sky-600 mt-0.5 hover:underline"
                              onClick={() => {
                                const v = parseNum(computed.netSuggested!);
                                if (v !== null) setValues(p => ({ ...p, "COLLATERAL.NET_VALUE": String(v) }));
                              }}
                            >
                              Use 80% of gross: {computed.netSuggested}
                            </button>
                          )}
                          {field.key === "COLLATERAL.DISCOUNTED_VALUE" && computed.discountedSuggested && !values["COLLATERAL.DISCOUNTED_VALUE"] && (
                            <button
                              className="text-[11px] text-sky-600 mt-0.5 hover:underline"
                              onClick={() => {
                                const v = parseNum(computed.discountedSuggested!);
                                if (v !== null) setValues(p => ({ ...p, "COLLATERAL.DISCOUNTED_VALUE": String(v) }));
                              }}
                            >
                              Use 60% of gross: {computed.discountedSuggested}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {group === "Financial Analysis" && (computed.dscr || computed.excessCF) && (
                      <div className="mt-3 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 space-y-1">
                        <div className="text-[11px] font-semibold text-sky-700 mb-1">Live Preview</div>
                        {computed.dscr && <div className="text-xs text-sky-800 flex justify-between"><span>DSCR</span><span className="font-semibold">{computed.dscr}</span></div>}
                        {computed.dscrStressed && <div className="text-xs text-sky-800 flex justify-between"><span>Stressed DSCR</span><span className="font-semibold">{computed.dscrStressed}</span></div>}
                        {computed.excessCF && <div className="text-xs text-sky-800 flex justify-between"><span>Excess Cash Flow</span><span className="font-semibold">{computed.excessCF}</span></div>}
                      </div>
                    )}
                    {group === "Sources & Uses" && (computed.ltvGross || computed.equityPct) && (
                      <div className="mt-3 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 space-y-1">
                        <div className="text-[11px] font-semibold text-sky-700 mb-1">Live Preview</div>
                        {computed.ltvGross && <div className="text-xs text-sky-800 flex justify-between"><span>LTV Gross</span><span className="font-semibold">{computed.ltvGross}</span></div>}
                        {computed.equityPct && <div className="text-xs text-sky-800 flex justify-between"><span>Borrower Equity %</span><span className="font-semibold">{computed.equityPct}</span></div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            {error && (
              <div className="px-6 py-2 bg-rose-50 border-t border-rose-100 text-xs text-rose-700">{error}</div>
            )}
            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 flex-shrink-0">
              <div className="text-xs text-gray-400">Values save to the fact database &mdash; memo refreshes automatically</div>
              <div className="flex gap-3">
                <button onClick={() => setOpen(false)} className="text-xs text-gray-600 hover:text-gray-900 px-3 py-2">Cancel</button>
                <button
                  onClick={save}
                  disabled={saving || saved || !hasAnyValue}
                  className={`text-xs font-semibold px-4 py-2 rounded-md transition-colors ${
                    saved ? "bg-emerald-600 text-white" :
                    saving ? "bg-gray-400 text-white cursor-wait" :
                    !hasAnyValue ? "bg-gray-200 text-gray-400 cursor-not-allowed" :
                    "bg-gray-900 text-white hover:bg-gray-700"
                  }`}
                >
                  {saved ? "Saved \u2713" : saving ? "Saving\u2026" : "Save & Refresh"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
