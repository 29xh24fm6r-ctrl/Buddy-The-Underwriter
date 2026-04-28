"use client";

// src/components/sba/SBACCOReviewDashboard.tsx
// Phase 2 — CCO review dashboard. Verdict header, key metrics, risk flags,
// inline-editable narratives, financial snapshot, sticky action bar.

import { useCallback, useEffect, useMemo, useState } from "react";

interface Props {
  dealId: string;
  packageId?: string;
}

type Verdict = "green" | "amber" | "red";

interface BenchmarkWarning {
  field: string;
  severity: "info" | "warning" | "concern";
  message: string;
}

interface SourcesAndUses {
  equityInjection?: {
    actualPct: number;
    minimumPct: number;
    passes: boolean;
    shortfallAmount: number;
  };
  totalSources?: number;
  totalUses?: number;
}

interface GlobalCashFlow {
  globalDSCR?: number;
  guarantorsWithNegativeCashFlow?: number;
}

interface ReviewPackage {
  id: string;
  deal_id: string;
  status: string;
  version_number: number | null;
  dscr_year1_base: number | null;
  dscr_year2_base: number | null;
  dscr_year3_base: number | null;
  dscr_year1_downside: number | null;
  dscr_below_threshold: boolean | null;
  break_even_revenue: number | null;
  margin_of_safety_pct: number | null;
  pdf_url: string | null;
  executive_summary: string | null;
  industry_analysis: string | null;
  marketing_strategy: string | null;
  operations_plan: string | null;
  swot_strengths: string | null;
  swot_weaknesses: string | null;
  swot_opportunities: string | null;
  swot_threats: string | null;
  sensitivity_narrative: string | null;
  business_overview_narrative: string | null;
  benchmark_warnings: BenchmarkWarning[] | null;
  package_warnings: BenchmarkWarning[] | null;
  sources_and_uses: SourcesAndUses | null;
  global_cash_flow: GlobalCashFlow | null;
  global_dscr: number | null;
  reviewer_notes: string | null;
  revision_requested_at: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  projections_annual:
    | Array<{
        revenue: number;
        ebitda: number;
        netIncome: number;
        dscr: number;
      }>
    | null;
  base_year_data: {
    revenue?: number;
    ebitda?: number;
    netIncome?: number;
  } | null;
}

const NARRATIVE_FIELDS: Array<{
  key: keyof ReviewPackage;
  label: string;
}> = [
  { key: "executive_summary", label: "Executive Summary" },
  { key: "business_overview_narrative", label: "Company Description" },
  { key: "industry_analysis", label: "Industry Analysis" },
  { key: "marketing_strategy", label: "Marketing Strategy" },
  { key: "operations_plan", label: "Operations Plan" },
  { key: "swot_strengths", label: "SWOT — Strengths" },
  { key: "swot_weaknesses", label: "SWOT — Weaknesses" },
  { key: "swot_opportunities", label: "SWOT — Opportunities" },
  { key: "swot_threats", label: "SWOT — Threats" },
  { key: "sensitivity_narrative", label: "Sensitivity Commentary" },
];

function fmtCurrency(val: number | null | undefined): string {
  if (val == null) return "—";
  return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function fmtPct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(1)}%`;
}
function fmtDscr(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${val.toFixed(2)}x`;
}

function computeVerdict(pkg: ReviewPackage): Verdict {
  const dscrFail =
    pkg.dscr_below_threshold ||
    (pkg.dscr_year1_base ?? 0) < 1.25 ||
    (pkg.dscr_year2_base ?? 0) < 1.25 ||
    (pkg.dscr_year3_base ?? 0) < 1.25;
  const equity = pkg.sources_and_uses?.equityInjection;
  const equityFail = equity ? !equity.passes : false;
  if (dscrFail || equityFail) return "red";

  const downsideTight = (pkg.dscr_year1_downside ?? 2) < 1.1;
  const mosTight = (pkg.margin_of_safety_pct ?? 1) < 0.1;
  const hasConcerns = (pkg.benchmark_warnings ?? []).some(
    (w) => w.severity === "concern",
  );
  if (downsideTight || mosTight || hasConcerns) return "amber";

  return "green";
}

const verdictStyles: Record<
  Verdict,
  { bg: string; text: string; border: string; label: string }
> = {
  green: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-300",
    border: "border-emerald-500/30",
    label: "Ready for Submission",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-300",
    border: "border-amber-500/30",
    label: "Review Required",
  },
  red: {
    bg: "bg-red-500/10",
    text: "text-red-300",
    border: "border-red-500/30",
    label: "Blockers Present",
  },
};

export default function SBACCOReviewDashboard({ dealId }: Props) {
  const [pkg, setPkg] = useState<ReviewPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openNarratives, setOpenNarratives] = useState<Record<string, boolean>>(
    {},
  );
  const [editBuffers, setEditBuffers] = useState<Record<string, string>>({});
  const [savingField, setSavingField] = useState<string | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/sba?view=review`);
      const json = await res.json();
      if (json.ok && json.package) {
        setPkg(json.package as ReviewPackage);
      } else {
        setLoadError(json.error ?? "No package found for this deal");
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    load();
  }, [load]);

  const verdict = useMemo(() => (pkg ? computeVerdict(pkg) : "amber"), [pkg]);

  const toggleNarrative = (key: string) =>
    setOpenNarratives((prev) => ({ ...prev, [key]: !prev[key] }));

  const saveNarrative = useCallback(
    async (field: string) => {
      const value = editBuffers[field];
      if (value === undefined) return;
      setSavingField(field);
      try {
        const res = await fetch(`/api/deals/${dealId}/sba`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "inline-edit-narrative", field, value }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "Save failed");
        setPkg((prev) =>
          prev ? ({ ...prev, [field]: value } as ReviewPackage) : prev,
        );
        setEditBuffers((prev) => {
          const { [field]: _, ...rest } = prev;
          return rest;
        });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setSavingField(null);
      }
    },
    [dealId, editBuffers],
  );

  const runAction = useCallback(
    async (action: "approve" | "request_changes" | "submit") => {
      setActionBusy(action);
      setActionError(null);
      setActionOk(null);
      try {
        // Map legacy action vocab → new dispatch action vocab
        const dispatchAction =
          action === "approve"
            ? "review-approve"
            : action === "request_changes"
              ? "review-request-changes"
              : "review-submit";
        const res = await fetch(`/api/deals/${dealId}/sba`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: dispatchAction,
            notes: actionNotes || undefined,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "Action failed");
        setActionOk(
          action === "approve"
            ? "Approved for submission."
            : action === "request_changes"
              ? "Changes requested."
              : "Submitted to lender.",
        );
        if (action === "request_changes") setActionNotes("");
        await load();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setActionBusy(null);
      }
    },
    [dealId, actionNotes, load],
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60">
        Loading package for review…
      </div>
    );
  }
  if (loadError || !pkg) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-300">
        {loadError ?? "No package found."}
      </div>
    );
  }

  const verdictStyle = verdictStyles[verdict];
  const equity = pkg.sources_and_uses?.equityInjection;
  const flags: Array<{ severity: string; message: string }> = [
    ...(pkg.benchmark_warnings ?? []).map((w) => ({
      severity: w.severity,
      message: w.message,
    })),
    ...(pkg.package_warnings ?? []).map((w) => ({
      severity: w.severity ?? "info",
      message: w.message,
    })),
  ];
  if (pkg.dscr_below_threshold) {
    flags.unshift({
      severity: "concern",
      message: "Base-case DSCR below 1.25x SBA minimum in at least one year.",
    });
  }
  if ((pkg.global_cash_flow?.guarantorsWithNegativeCashFlow ?? 0) > 0) {
    flags.push({
      severity: "warning",
      message: `${pkg.global_cash_flow!.guarantorsWithNegativeCashFlow} guarantor(s) with negative personal cash flow.`,
    });
  }

  return (
    <div className="space-y-4 pb-32">
      {/* 1. VERDICT HEADER */}
      <div
        className={`rounded-2xl border p-5 ${verdictStyle.bg} ${verdictStyle.border}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-[11px] uppercase tracking-wider font-semibold ${verdictStyle.text}`}>
              CCO Review Verdict
            </div>
            <h2 className={`mt-1 text-2xl font-bold ${verdictStyle.text}`}>
              {verdictStyle.label}
            </h2>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/50">Version</div>
            <div className="text-lg font-mono text-white">
              {pkg.version_number ?? 1}
            </div>
            <div className="mt-1 text-xs text-white/50">Status</div>
            <div className="text-sm font-semibold text-white">{pkg.status}</div>
          </div>
        </div>
      </div>

      {/* 2. KEY METRICS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="DSCR Year 1"
          value={fmtDscr(pkg.dscr_year1_base)}
          tone={
            (pkg.dscr_year1_base ?? 0) >= 1.25 ? "emerald" : (pkg.dscr_year1_base ?? 0) >= 1.0 ? "amber" : "red"
          }
          hint="SBA minimum: 1.25x"
        />
        <MetricCard
          label="Global DSCR"
          value={fmtDscr(pkg.global_dscr ?? pkg.global_cash_flow?.globalDSCR)}
          tone={
            (pkg.global_dscr ?? pkg.global_cash_flow?.globalDSCR ?? 0) >= 1.25
              ? "emerald"
              : "amber"
          }
          hint="Business + guarantors"
        />
        <MetricCard
          label="Break-Even MoS"
          value={fmtPct(pkg.margin_of_safety_pct)}
          tone={(pkg.margin_of_safety_pct ?? 0) >= 0.1 ? "emerald" : "amber"}
          hint="Margin of safety"
        />
        <MetricCard
          label="Equity Injection"
          value={fmtPct(equity?.actualPct ?? null)}
          tone={equity ? (equity.passes ? "emerald" : "red") : "amber"}
          hint={
            equity
              ? equity.passes
                ? `Meets ${(equity.minimumPct * 100).toFixed(0)}% minimum`
                : `Below ${(equity.minimumPct * 100).toFixed(0)}% min`
              : "Not computed"
          }
        />
      </div>

      {/* 3. RISK FLAGS */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Risk Flags</h3>
        {flags.length === 0 ? (
          <div className="text-xs text-white/50">No risk flags.</div>
        ) : (
          <ul className="space-y-1.5">
            {flags.map((f, idx) => {
              const tone =
                f.severity === "concern"
                  ? "text-red-300 border-red-500/30"
                  : f.severity === "warning"
                    ? "text-amber-300 border-amber-500/30"
                    : "text-blue-300 border-blue-500/30";
              return (
                <li
                  key={idx}
                  className={`rounded-md border-l-2 ${tone} bg-white/[0.02] px-3 py-2 text-xs`}
                >
                  <span className="font-semibold uppercase mr-2">
                    {f.severity}
                  </span>
                  {f.message}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 4. NARRATIVE PREVIEW */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Narratives</h3>
        {NARRATIVE_FIELDS.map((f) => {
          const body = (pkg[f.key] as string | null) ?? "";
          const editing = editBuffers[f.key] !== undefined;
          const currentValue = editing ? editBuffers[f.key] : body;
          const open = openNarratives[f.key] || editing;
          return (
            <div
              key={String(f.key)}
              className="rounded-md border border-white/10 bg-white/[0.02]"
            >
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-left"
                onClick={() => toggleNarrative(String(f.key))}
              >
                <span className="text-sm font-semibold text-white/80">{f.label}</span>
                <span className="text-xs text-white/50">
                  {body ? `${body.slice(0, 80)}${body.length > 80 ? "…" : ""}` : "Not generated"}
                </span>
              </button>
              {open && (
                <div className="border-t border-white/10 p-3 space-y-2">
                  <textarea
                    className="w-full h-40 rounded-md border border-white/10 bg-black/40 p-2 text-xs text-white/80 font-mono"
                    value={currentValue}
                    onChange={(e) =>
                      setEditBuffers((prev) => ({
                        ...prev,
                        [f.key as string]: e.target.value,
                      }))
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={savingField === String(f.key) || !editing}
                      onClick={() => saveNarrative(String(f.key))}
                      className="text-xs rounded-md border border-white/20 bg-white/[0.06] px-3 py-1 text-white/80 hover:bg-white/[0.1] disabled:opacity-40"
                    >
                      {savingField === String(f.key) ? "Saving…" : "Save"}
                    </button>
                    {editing && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditBuffers((prev) => {
                            const { [f.key as string]: _, ...rest } = prev;
                            return rest;
                          })
                        }
                        className="text-xs text-white/60 hover:text-white"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 5. FINANCIAL SNAPSHOT */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white/80">Financial Snapshot</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/50">
                <th className="text-left py-1 pr-3"></th>
                <th className="text-right py-1 px-2">Base</th>
                <th className="text-right py-1 px-2">Y1</th>
                <th className="text-right py-1 px-2">Y2</th>
                <th className="text-right py-1 px-2">Y3</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Revenue", "revenue"],
                  ["EBITDA", "ebitda"],
                  ["Net Income", "netIncome"],
                ] as const
              ).map(([label, key]) => (
                <tr key={label} className="border-t border-white/5">
                  <td className="py-1 pr-3 text-white/70">{label}</td>
                  <td className="text-right py-1 px-2 font-mono text-white/70">
                    {fmtCurrency(
                      (pkg.base_year_data as Record<string, number> | null)?.[
                        key
                      ],
                    )}
                  </td>
                  {(pkg.projections_annual ?? []).slice(0, 3).map((p, i) => (
                    <td key={i} className="text-right py-1 px-2 font-mono text-white/70">
                      {fmtCurrency(
                        (p as unknown as Record<string, number>)[key],
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-white/5">
                <td className="py-1 pr-3 text-white/70">DSCR</td>
                <td className="text-right py-1 px-2 font-mono text-white/50">—</td>
                <td className="text-right py-1 px-2 font-mono">
                  {fmtDscr(pkg.dscr_year1_base)}
                </td>
                <td className="text-right py-1 px-2 font-mono">
                  {fmtDscr(pkg.dscr_year2_base)}
                </td>
                <td className="text-right py-1 px-2 font-mono">
                  {fmtDscr(pkg.dscr_year3_base)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {pkg.sources_and_uses && (
          <div className="pt-2 border-t border-white/10">
            <div className="text-xs text-white/50 mb-1">Sources &amp; Uses</div>
            <div className="flex gap-6 text-xs">
              <div>
                <span className="text-white/50">Total Sources:</span>{" "}
                <span className="font-mono text-white/80">
                  {fmtCurrency(pkg.sources_and_uses.totalSources)}
                </span>
              </div>
              <div>
                <span className="text-white/50">Total Uses:</span>{" "}
                <span className="font-mono text-white/80">
                  {fmtCurrency(pkg.sources_and_uses.totalUses)}
                </span>
              </div>
              {equity && (
                <div>
                  <span className="text-white/50">Equity:</span>{" "}
                  <span
                    className={`font-mono ${
                      equity.passes ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {fmtPct(equity.actualPct)}
                    {!equity.passes &&
                      ` (short ${fmtCurrency(equity.shortfallAmount)})`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Reviewer Notes */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Reviewer Notes</h3>
        <textarea
          className="w-full h-20 rounded-md border border-white/10 bg-black/40 p-2 text-xs text-white/80"
          placeholder="Add notes for the borrower (required when requesting changes)"
          value={actionNotes}
          onChange={(e) => setActionNotes(e.target.value)}
        />
        {pkg.reviewer_notes && (
          <div className="text-xs text-white/50">
            Last notes on file:{" "}
            <span className="text-white/70">{pkg.reviewer_notes}</span>
          </div>
        )}
      </div>

      {/* 6. ACTION BAR — sticky bottom */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1a]/95 backdrop-blur-sm px-4 py-3">
        <div className="mx-auto max-w-[1400px] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            {actionError && (
              <span className="text-red-300">{actionError}</span>
            )}
            {actionOk && <span className="text-emerald-300">{actionOk}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!pkg.pdf_url}
              onClick={() => pkg.pdf_url && window.open(`/api/storage/${pkg.pdf_url}`, "_blank")}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40"
            >
              Download PDF
            </button>
            <button
              type="button"
              disabled={actionBusy !== null}
              onClick={() => runAction("request_changes")}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300 hover:bg-amber-500/15 disabled:opacity-40"
            >
              {actionBusy === "request_changes" ? "…" : "Request Changes"}
            </button>
            <button
              type="button"
              disabled={actionBusy !== null || pkg.status === "submitted"}
              onClick={() => runAction("approve")}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {actionBusy === "approve" ? "…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={actionBusy !== null || pkg.status !== "reviewed"}
              onClick={() => runAction("submit")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              title={
                pkg.status !== "reviewed"
                  ? "Approve the package before submitting"
                  : undefined
              }
            >
              {actionBusy === "submit" ? "…" : "Submit to Lender"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "emerald" | "amber" | "red";
  hint?: string;
}) {
  const toneMap = {
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    red: "text-red-300",
  } as const;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[11px] uppercase tracking-wider text-white/50">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-mono font-semibold ${toneMap[tone]}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-white/40 mt-1">{hint}</div>}
    </div>
  );
}
