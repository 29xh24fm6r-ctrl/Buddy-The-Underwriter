"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type SpreadRow = {
  deal_id: string;
  bank_id: string;
  spread_type: string;
  spread_version: number;
  status: "ready" | "generating" | "error" | string;
  rendered_json: any;
  updated_at: string;
  error: string | null;
};

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function DealFinancialSpreadsPanel({ dealId }: { dealId: string }) {
  const [loading, setLoading] = React.useState(false);
  const [recomputing, setRecomputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [spreads, setSpreads] = React.useState<SpreadRow[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/spreads`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to load spreads");
      }
      setSpreads(Array.isArray(json.spreads) ? json.spreads : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load spreads");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const hasGenerating = spreads.some((s) => String(s.status) === "generating");
    if (!hasGenerating) return;

    const id = window.setInterval(() => {
      void load();
    }, 12_000);

    return () => window.clearInterval(id);
  }, [spreads, load]);

  async function recompute() {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/spreads/recompute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to enqueue recompute");
      }
      // Give the worker a moment, then refresh.
      window.setTimeout(() => void load(), 750);
    } catch (e: any) {
      setError(e?.message ?? "Failed to enqueue recompute");
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon name="fact_check" className="h-5 w-5 text-neutral-900" />
          <h3 className="text-sm font-semibold">Financial Spreads</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void recompute()}
            disabled={recomputing}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            <Icon name={recomputing ? "pending" : "sync"} className="h-4 w-4" />
            Recompute
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-xs text-neutral-500">Loading spreads…</div>
      ) : spreads.length === 0 ? (
        <div className="text-xs text-neutral-600">
          No spreads generated yet. Click <span className="font-semibold">Recompute</span> to enqueue generation.
        </div>
      ) : (
        <div className="space-y-3">
          {spreads.map((s) => {
            const title = String(s.rendered_json?.title ?? s.spread_type);
            const status = String(s.status ?? "");
            return (
              <div key={`${s.spread_type}:${s.spread_version}`} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-900">{title}</div>
                  <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-neutral-700">
                      {status}
                    </span>
                    <span>Updated {formatTimestamp(s.updated_at)}</span>
                  </div>
                </div>

                {s.error ? (
                  <div className="mt-2 text-xs text-red-700">{s.error}</div>
                ) : null}

                {Array.isArray(s.rendered_json?.rows) ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr>
                          {Array.isArray(s.rendered_json?.columns)
                            ? s.rendered_json.columns.map((c: any) => (
                                <th
                                  key={String(c)}
                                  className="border-b border-neutral-200 bg-white px-2 py-1 text-left font-semibold text-neutral-700"
                                >
                                  {String(c)}
                                </th>
                              ))
                            : null}
                        </tr>
                      </thead>
                      <tbody>
                        {s.rendered_json.rows.slice(0, 24).map((r: any) => (
                          <tr key={String(r?.key ?? r?.label ?? Math.random())}>
                            <td className="border-b border-neutral-100 px-2 py-1 font-medium text-neutral-900">
                              {String(r?.label ?? "")}
                            </td>
                            <td className="border-b border-neutral-100 px-2 py-1 text-neutral-700">
                              {Array.isArray(r?.values) ? String(r.values[0] ?? "") : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s.rendered_json.rows.length > 24 ? (
                      <div className="mt-2 text-[11px] text-neutral-500">
                        Showing first 24 rows.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
