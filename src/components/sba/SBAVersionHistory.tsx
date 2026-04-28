"use client";

// src/components/sba/SBAVersionHistory.tsx
// Phase BPG — Vertical timeline of SBA package versions + diff modal.

import { useCallback, useEffect, useState } from "react";

interface VersionRow {
  id: string;
  version_number: number;
  created_at: string;
  status: string;
  dscr_year1_base: number | null;
  dscr_below_threshold: boolean | null;
  break_even_revenue: number | null;
  margin_of_safety_pct: number | null;
}

interface DiffChange {
  field: string;
  v1Value: number | null;
  v2Value: number | null;
  delta: number | null;
}

interface DiffResponse {
  ok: boolean;
  v1?: VersionRow & { projections_annual?: unknown };
  v2?: VersionRow & { projections_annual?: unknown };
  changes?: DiffChange[];
  error?: string;
}

function fmtCurrency(val: number | null): string {
  if (val === null) return "—";
  return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function fmtPct(val: number | null): string {
  if (val === null) return "—";
  return `${(val * 100).toFixed(1)}%`;
}
function fmtDscr(val: number | null): string {
  if (val === null) return "—";
  return `${val.toFixed(2)}x`;
}

function statusPill(status: string) {
  const map: Record<string, string> = {
    draft: "bg-amber-500/20 text-amber-300 border-amber-400/30",
    reviewed: "bg-blue-500/20 text-blue-300 border-blue-400/30",
    submitted: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
  };
  const cls = map[status] ?? "bg-white/10 text-white/70 border-white/20";
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

export default function SBAVersionHistory({ dealId }: { dealId: string }) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ v1: string | null; v2: string | null }>(
    { v1: null, v2: null },
  );
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/deals/${dealId}/sba?view=versions`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setVersions(json.versions ?? []);
        } else {
          setError(json.error ?? "Failed to load versions");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.v1 === id) return { v1: null, v2: prev.v2 };
      if (prev.v2 === id) return { v1: prev.v1, v2: null };
      if (!prev.v1) return { v1: id, v2: prev.v2 };
      if (!prev.v2) return { v1: prev.v1, v2: id };
      return { v1: prev.v2, v2: id };
    });
  }, []);

  const runCompare = useCallback(async () => {
    if (!selected.v1 || !selected.v2) return;
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/sba?view=diff&v1=${encodeURIComponent(selected.v1)}&v2=${encodeURIComponent(selected.v2)}`,
      );
      const json: DiffResponse = await res.json();
      setDiff(json);
    } catch (e) {
      setDiff({
        ok: false,
        error: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setDiffLoading(false);
    }
  }, [dealId, selected.v1, selected.v2]);

  const closeDiff = useCallback(() => setDiff(null), []);

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
        Loading version history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        No SBA package versions yet.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">Version History</h3>
          <button
            type="button"
            disabled={!selected.v1 || !selected.v2}
            onClick={runCompare}
            className="text-xs rounded-md border border-white/20 px-3 py-1.5 text-white/80 hover:bg-white/[0.06] disabled:opacity-40"
          >
            Compare 2 versions
          </button>
        </div>

        <ol className="relative border-l border-white/10 ml-3 pl-5 space-y-4">
          {versions.map((v) => {
            const checked = selected.v1 === v.id || selected.v2 === v.id;
            return (
              <li key={v.id} className="relative">
                <span
                  className={`absolute -left-[29px] top-1.5 h-3 w-3 rounded-full border ${
                    checked
                      ? "bg-blue-500 border-blue-300"
                      : "bg-white/10 border-white/30"
                  }`}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        Version {v.version_number}
                      </span>
                      {statusPill(v.status)}
                      <span className="text-xs text-white/50">
                        {new Date(v.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-xs text-white/70">
                      <div>
                        <span className="text-white/40">DSCR Y1</span>{" "}
                        <span
                          className={
                            v.dscr_below_threshold
                              ? "text-red-300"
                              : "text-emerald-300"
                          }
                        >
                          {fmtDscr(v.dscr_year1_base)}
                        </span>
                      </div>
                      <div>
                        <span className="text-white/40">Break-Even</span>{" "}
                        {fmtCurrency(v.break_even_revenue)}
                      </div>
                      <div>
                        <span className="text-white/40">MoS</span>{" "}
                        {fmtPct(v.margin_of_safety_pct)}
                      </div>
                    </div>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-white/60 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelect(v.id)}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    Select
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {diff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closeDiff}
        >
          <div
            className="max-w-2xl w-full rounded-xl border border-white/10 bg-neutral-950 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Version Comparison
              </h3>
              <button
                onClick={closeDiff}
                className="text-white/60 hover:text-white text-sm"
              >
                Close
              </button>
            </div>
            {diffLoading && (
              <div className="text-sm text-white/60">Loading diff…</div>
            )}
            {diff.error && (
              <div className="text-sm text-red-300">{diff.error}</div>
            )}
            {diff.ok && diff.changes && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-white/50 text-xs">
                    <th className="text-left py-1">Field</th>
                    <th className="text-right py-1">v{diff.v1?.version_number}</th>
                    <th className="text-right py-1">v{diff.v2?.version_number}</th>
                    <th className="text-right py-1">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changes.map((c) => (
                    <tr key={c.field} className="border-t border-white/10">
                      <td className="py-1.5 text-white/70">{c.field}</td>
                      <td className="py-1.5 text-right text-white/60">
                        {c.v1Value ?? "—"}
                      </td>
                      <td className="py-1.5 text-right text-white/60">
                        {c.v2Value ?? "—"}
                      </td>
                      <td
                        className={`py-1.5 text-right font-mono ${
                          c.delta === null
                            ? "text-white/40"
                            : c.delta > 0
                              ? "text-emerald-300"
                              : c.delta < 0
                                ? "text-red-300"
                                : "text-white/60"
                        }`}
                      >
                        {c.delta === null
                          ? "—"
                          : `${c.delta > 0 ? "+" : ""}${c.delta.toFixed(2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
