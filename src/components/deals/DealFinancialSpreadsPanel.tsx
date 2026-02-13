"use client";

import * as React from "react";
import { Icon } from "@/components/ui/Icon";

type SpreadRow = {
  deal_id: string;
  bank_id: string;
  spread_type: string;
  spread_version: number;
  status: "ready" | "generating" | "queued" | "error" | string;
  rendered_json: any;
  updated_at: string;
  error: string | null;
};

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return ts;
  return d.toLocaleString("en-US");
}

function displayCell(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "object" && v && "value" in v) {
    const inner = (v as any).value;
    if (inner === null || inner === undefined) return "";
    return String(inner);
  }
  return String(v);
}

export default function DealFinancialSpreadsPanel({ dealId }: { dealId: string }) {
  const [loading, setLoading] = React.useState(false);
  const [recomputing, setRecomputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [spreads, setSpreads] = React.useState<SpreadRow[]>([]);
  const [expandedBySpread, setExpandedBySpread] = React.useState<Record<string, boolean>>({});
  const [rentRollFilterBySpread, setRentRollFilterBySpread] = React.useState<Record<string, "ALL" | "OCCUPIED" | "VACANT">>({});

function formatNumberForRow(rowKey: string, v: number): string {
  if (!Number.isFinite(v)) return "";
  if (rowKey === "OPEX_RATIO" || rowKey === "NOI_MARGIN") {
    return `${(v * 100).toFixed(1)}%`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function displaySpreadGridValue(args: { rowKey: string; cell: any; colKey: string }): string {
  const cellObj = args.cell;
  if (cellObj && typeof cellObj === "object") {
    const byDisplay = cellObj.displayByCol?.[args.colKey];
    if (byDisplay !== undefined && byDisplay !== null) return String(byDisplay);

    const byVal = cellObj.valueByCol?.[args.colKey];
    if (typeof byVal === "number") return formatNumberForRow(args.rowKey, byVal);
    if (typeof byVal === "string") return byVal;

    // Back-compat: some templates still set `value`.
    if (args.colKey === "TTM" && typeof cellObj.value === "number") return formatNumberForRow(args.rowKey, cellObj.value);
  }
  return "—";
}

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
    const hasGenerating = spreads.some(
      (s) => String(s.status) === "generating" || String(s.status) === "queued",
    );
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
            const spreadKey = `${s.spread_type}:${s.spread_version}`;
            const isRentRoll = String(s.spread_type) === "RENT_ROLL";
            const colDefs = Array.isArray(s.rendered_json?.columnsV2) ? (s.rendered_json.columnsV2 as any[]) : null;
            const expanded = Boolean(expandedBySpread[spreadKey]);
            const shownColDefs =
              colDefs && colDefs.length
                ? isRentRoll
                  ? colDefs
                  : expanded
                    ? colDefs
                    : colDefs.filter((c: any) => c?.kind === "ttm" || c?.kind === "ytd")
                : null;

            const rrFilter = rentRollFilterBySpread[spreadKey] ?? "ALL";

            const rrRowsAll = Array.isArray(s.rendered_json?.rows) ? (s.rendered_json.rows as any[]) : [];
            const rrUnitRows = rrRowsAll.filter((r) => !["TOTAL_OCCUPIED", "TOTAL_VACANT", "TOTALS"].includes(String(r?.key ?? "")));
            const rrTotalsRows = rrRowsAll.filter((r) => ["TOTAL_OCCUPIED", "TOTAL_VACANT", "TOTALS"].includes(String(r?.key ?? "")));
            const rrFilteredUnitRows =
              rrFilter === "ALL"
                ? rrUnitRows
                : rrUnitRows.filter((r) => {
                    const cell = Array.isArray(r?.values) ? r.values[0] : null;
                    const statusVal = cell?.valueByCol?.STATUS ?? cell?.valueByCol?.status;
                    return String(statusVal ?? "").toUpperCase() === rrFilter;
                  });

            const rrShownTotalsRows =
              rrFilter === "ALL"
                ? rrTotalsRows
                : rrTotalsRows.filter((r) =>
                    rrFilter === "OCCUPIED"
                      ? ["TOTAL_OCCUPIED", "TOTALS"].includes(String(r?.key ?? ""))
                      : ["TOTAL_VACANT", "TOTALS"].includes(String(r?.key ?? "")),
                  );

            const rrRowsForDisplay = isRentRoll ? [...rrFilteredUnitRows, ...rrShownTotalsRows] : rrRowsAll;

            return (
              <div key={`${s.spread_type}:${s.spread_version}`} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold text-neutral-900">{title}</div>
                    {colDefs && colDefs.length && !isRentRoll ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedBySpread((prev) => ({
                            ...prev,
                            [spreadKey]: !Boolean(prev[spreadKey]),
                          }))
                        }
                        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                      >
                        {expanded ? "Collapse months" : "Show months"}
                      </button>
                    ) : null}
                  </div>
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

                {isRentRoll ? (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-neutral-700">Filter</span>
                    {(["ALL", "OCCUPIED", "VACANT"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setRentRollFilterBySpread((prev) => ({ ...prev, [spreadKey]: opt }))}
                        className={
                          opt === rrFilter
                            ? "rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-white"
                            : "rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                        }
                      >
                        {opt === "ALL" ? "All" : opt === "OCCUPIED" ? "Occupied" : "Vacant"}
                      </button>
                    ))}
                  </div>
                ) : null}

                {Array.isArray(s.rendered_json?.rows) ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr className="sticky top-0">
                          {shownColDefs && shownColDefs.length ? (
                            <>
                              {isRentRoll ? (
                                shownColDefs.map((c: any, idx: number) => (
                                  <th
                                    key={String(c?.key ?? c?.label ?? idx)}
                                    className={
                                      idx === 0
                                        ? "sticky left-0 z-10 border-b border-neutral-200 bg-white px-2 py-1 text-left font-semibold text-neutral-700"
                                        : "border-b border-neutral-200 bg-white px-2 py-1 text-left font-semibold text-neutral-700"
                                    }
                                  >
                                    {String(c?.label ?? "")}
                                  </th>
                                ))
                              ) : (
                                <>
                                  <th className="sticky left-0 border-b border-neutral-200 bg-white px-2 py-1 text-left font-semibold text-neutral-700">
                                    Line Item
                                  </th>
                                  {shownColDefs.map((c: any, ci: number) => (
                                    <th
                                      key={String(c?.key ?? c?.label ?? ci)}
                                      className="border-b border-neutral-200 bg-white px-2 py-1 text-right font-semibold text-neutral-700"
                                    >
                                      {String(c?.label ?? "")}
                                    </th>
                                  ))}
                                </>
                              )}
                            </>
                          ) : Array.isArray(s.rendered_json?.columns) ? (
                            s.rendered_json.columns.map((c: any) => (
                              <th
                                key={String(c)}
                                className="border-b border-neutral-200 bg-white px-2 py-1 text-left font-semibold text-neutral-700"
                              >
                                {String(c)}
                              </th>
                            ))
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {(isRentRoll ? rrRowsForDisplay : s.rendered_json.rows).slice(0, 24).map((r: any, ri: number) => (
                          <tr key={String(r?.key ?? r?.label ?? ri)}>
                            {shownColDefs && shownColDefs.length ? (
                              <>
                                {isRentRoll ? (
                                  <>
                                    {shownColDefs.map((c: any, idx: number) => (
                                      <td
                                        key={String(c?.key ?? idx)}
                                        className={
                                          idx === 0
                                            ? "sticky left-0 z-10 border-b border-neutral-100 bg-white px-2 py-1 font-medium text-neutral-900"
                                            : "border-b border-neutral-100 px-2 py-1 text-neutral-700"
                                        }
                                      >
                                        {displaySpreadGridValue({
                                          rowKey: String(r?.key ?? ""),
                                          cell: Array.isArray(r?.values) ? r.values[0] : null,
                                          colKey: String(c?.key ?? ""),
                                        })}
                                      </td>
                                    ))}
                                  </>
                                ) : (
                                  <>
                                    <td className="sticky left-0 border-b border-neutral-100 bg-white px-2 py-1 font-medium text-neutral-900">
                                      {String(r?.label ?? "")}
                                    </td>
                                    {shownColDefs.map((c: any, ci: number) => (
                                      <td
                                        key={String(c?.key ?? ci)}
                                        className="border-b border-neutral-100 px-2 py-1 text-right text-neutral-700"
                                      >
                                        {displaySpreadGridValue({
                                          rowKey: String(r?.key ?? ""),
                                          cell: Array.isArray(r?.values) ? r.values[0] : null,
                                          colKey: String(c?.key ?? ""),
                                        })}
                                      </td>
                                    ))}
                                  </>
                                )}
                              </>
                            ) : Array.isArray(s.rendered_json?.columns) && s.rendered_json.columns.length > 0 ? (
                              s.rendered_json.columns.map((_: any, colIdx: number) => {
                                if (colIdx === 0) {
                                  return (
                                    <td
                                      key={`c${colIdx}`}
                                      className="border-b border-neutral-100 px-2 py-1 font-medium text-neutral-900"
                                    >
                                      {String(r?.label ?? "")}
                                    </td>
                                  );
                                }

                                const cell = Array.isArray(r?.values) ? r.values[colIdx - 1] : null;
                                return (
                                  <td key={`c${colIdx}`} className="border-b border-neutral-100 px-2 py-1 text-neutral-700">
                                    {displayCell(cell)}
                                  </td>
                                );
                              })
                            ) : (
                              <>
                                <td className="border-b border-neutral-100 px-2 py-1 font-medium text-neutral-900">
                                  {String(r?.label ?? "")}
                                </td>
                                <td className="border-b border-neutral-100 px-2 py-1 text-neutral-700">
                                  {Array.isArray(r?.values) ? displayCell(r.values[0]) : ""}
                                </td>
                              </>
                            )}
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
