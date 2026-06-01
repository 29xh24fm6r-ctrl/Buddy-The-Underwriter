"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  SpreadTable,
  classifyRowKind,
  extractCellValue,
  type SpreadTableColumn,
  type SpreadTableRow,
} from "@/components/deals/spreads/SpreadTable";
import { cn } from "@/lib/utils";

type SpreadData = {
  spread_type: string;
  spread_version: number;
  status: string;
  rendered_json: any;
  updated_at: string;
  error: string | null;
  error_code?: string | null;
  error_details_json?: any;
  owner_type?: string;
  owner_entity_id?: string | null;
};

// SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1: deal_spreads status lifecycle is
// queued → generating → ready | error. Both "queued" and "generating" are active
// compute states; the page used to treat only "generating" as work-in-progress,
// so a freshly-enqueued "queued" GLOBAL_CASH_FLOW row showed no progress.
const ACTIVE_STATUSES = new Set(["queued", "generating"]);

function isActiveSpread(s: SpreadData): boolean {
  return ACTIVE_STATUSES.has(s.status);
}

function hasGcfValue(s: SpreadData): boolean {
  return extractGcfKpis(s).some((k) => k.label === "Global Cash Flow");
}

type KpiValue = { label: string; value: string; color?: string };

function extractGcfKpis(spread: SpreadData): KpiValue[] {
  const rows = spread.rendered_json?.rows;
  if (!Array.isArray(rows)) return [];

  const kpis: KpiValue[] = [];

  for (const r of rows) {
    const cell = Array.isArray(r.values) ? r.values[0] : null;
    const v = cell && typeof cell === "object" ? cell.value : cell;

    if (r.key === "GCF_GLOBAL_CASH_FLOW" && typeof v === "number") {
      kpis.push({
        label: "Global Cash Flow",
        value: formatCompact(v),
        color: v >= 0 ? "text-emerald-400" : "text-red-400",
      });
    }
    if (r.key === "GCF_DSCR" && typeof v === "number") {
      kpis.push({
        label: "Global DSCR",
        value: v.toFixed(2) + "x",
        color: v >= 1.25 ? "text-emerald-400" : v >= 1.0 ? "text-amber-400" : "text-red-400",
      });
    }
    if (r.key === "GCF_DSCR_STRESSED" && typeof v === "number") {
      kpis.push({
        label: "Stressed DSCR",
        value: v.toFixed(2) + "x",
        color: v >= 1.0 ? "text-emerald-400" : "text-red-400",
      });
    }
    if (r.key === "GCF_CASH_AVAILABLE" && typeof v === "number") {
      kpis.push({
        label: "Cash Available",
        value: formatCompact(v),
      });
    }
  }

  return kpis;
}

function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Build table rows, grouping by section with visual headers */
function buildGcfRows(spread: SpreadData): SpreadTableRow[] {
  const rows = spread.rendered_json?.rows;
  if (!Array.isArray(rows)) return [];

  const result: SpreadTableRow[] = [];
  let lastSection: string | null = null;

  for (const r of rows) {
    const section = r.section ?? null;

    if (section && section !== lastSection) {
      result.push({
        key: `_section_${section}`,
        label: gcfSectionLabel(section),
        section,
        kind: "section_header",
        values: [],
      });
    }
    lastSection = section;

    const kind = classifyGcfRowKind(r);
    const cell = Array.isArray(r.values) ? r.values[0] : null;
    const value = extractCellValue(cell, r.key);

    result.push({
      key: r.key,
      label: r.label ?? r.key,
      section,
      kind,
      values: [value],
      formula: r.formula ?? null,
    });
  }

  return result;
}

function gcfSectionLabel(section: string): string {
  const labels: Record<string, string> = {
    PERSONAL: "Income Sources",
    PROPERTY: "Property Cash Flow",
    GLOBAL: "Global Aggregation",
    DSCR: "Coverage Ratios",
  };
  return labels[section] ?? section.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function classifyGcfRowKind(row: any): import("@/components/deals/spreads/SpreadTable").SpreadRowKind {
  const k = String(row.key).toUpperCase();

  // Key totals
  if (k === "GCF_GLOBAL_CASH_FLOW" || k === "GCF_CASH_AVAILABLE" || k === "GCF_TOTAL_OBLIGATIONS") {
    return "total";
  }

  // DSCR ratios
  if (k.includes("DSCR")) return "ratio";

  // Derived formulas
  if (k === "GCF_PROPERTY_CASHFLOW" || k === "EXCESS_CASH_FLOW") return "derived";

  // Everything else is a source
  return "source";
}

export default function GlobalCashFlowPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [spreads, setSpreads] = React.useState<SpreadData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // SPEC-GCF-FIXPATH-DEEP-LINK-1: banker-initiated GCF computation, so the
  // missing_global_cash_flow Fix Now path lands on a page with a real resolving
  // action rather than a read-only dead-end.
  const [recomputing, setRecomputing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/spreads?types=GLOBAL_CASH_FLOW`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load spreads");
      // Pick the latest version (v3 preferred)
      const all = Array.isArray(json.spreads) ? json.spreads as SpreadData[] : [];
      setSpreads(all);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  const compute = React.useCallback(async () => {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/spreads/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: ["GLOBAL_CASH_FLOW"] }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to start global cash flow computation");
      }
      // Reload picks up the "queued" row immediately; the poll effect below
      // keeps refreshing through queued → generating → ready.
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to start computation");
    } finally {
      setRecomputing(false);
    }
  }, [dealId, load]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    // Poll while ANY GCF row is queued or generating — not just generating.
    if (!spreads.some(isActiveSpread)) return;
    const id = window.setInterval(() => void load(), 6_000);
    return () => window.clearInterval(id);
  }, [spreads, load]);

  const columns: SpreadTableColumn[] = [
    { key: "label", label: "Line Item", align: "left" },
    { key: "value", label: "Amount", align: "right" },
  ];

  // SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1: select the canonical GCF row
  // deterministically rather than blindly taking the newest row by updated_at,
  // which could be a freshly-queued GLOBAL row with no value OR a stale legacy
  // DEAL-owned ready row — either of which produced a misleading empty screen.
  const isComputing = spreads.some(isActiveSpread);

  // The displayable result: a row that actually carries the GCF figure. Prefer
  // the canonical GLOBAL owner_type, then the most recently updated.
  const readySpread =
    [...spreads]
      .filter(hasGcfValue)
      .sort((a, b) => {
        const ag = a.owner_type === "GLOBAL" ? 0 : 1;
        const bg = b.owner_type === "GLOBAL" ? 0 : 1;
        if (ag !== bg) return ag - bg;
        return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
      })[0] ?? null;

  const errorSpread = spreads.find((s) => s.status === "error") ?? null;

  const gcfSpread = readySpread;
  const kpis = readySpread ? extractGcfKpis(readySpread) : [];

  // What to show, in priority order: computing → ready → error → missing.
  const view: "loading" | "computing" | "ready" | "error" | "missing" = loading
    ? "loading"
    : isComputing
    ? "computing"
    : readySpread
    ? "ready"
    : errorSpread
    ? "error"
    : "missing";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Global Cash Flow</h2>
          <p className="mt-0.5 text-xs text-white/50">
            Cross-entity aggregation: personal income + property NOI - obligations = global cash flow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* SPEC-GCF-READY-STATE-RECOMPUTE-CTA-1: in the ready state the compute
              action otherwise disappears (it only lived in the missing/error
              banners), so the banker couldn't intentionally recompute GCF after
              fixes/new docs. Refresh stays a data reload only; this recomputes the
              underwriting calculation (enqueues a job → Computing… → ready/error). */}
          {view === "ready" && (
            <button
              type="button"
              onClick={() => void compute()}
              disabled={recomputing || isComputing}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-60"
            >
              <Icon name="sync" className="h-4 w-4" />
              {recomputing ? "Starting…" : "Recompute Global Cash Flow"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Transient fetch/compute error (network-level), distinct from a failed
          spread row which is rendered as the "error" view below. */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* SPEC-GCF-COMPUTE-QUEUED-POLLING-AND-STATUS-1: explicit state machine so
          a queued/generating row never falls back to "No analysis yet". */}
      {view === "loading" && (
        <div className="py-12 text-center text-xs text-white/50">Loading global cash flow...</div>
      )}

      {view === "computing" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <Icon name="sync" className="mt-0.5 h-5 w-5 animate-spin text-amber-300" />
            <div>
              <h3 className="text-sm font-semibold text-amber-100">
                Computing Global Cash Flow…
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                The global cash flow analysis is queued and being generated. This
                page refreshes automatically — no action needed.
              </p>
            </div>
          </div>
        </div>
      )}

      {view === "error" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Icon name="error" className="mt-0.5 h-5 w-5 text-red-300" />
              <div>
                <h3 className="text-sm font-semibold text-red-100">
                  Global Cash Flow computation failed
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-red-200/80">
                  {errorSpread?.error_code
                    ? `${errorSpread.error_code}: `
                    : ""}
                  {errorSpread?.error ?? "The computation did not complete. Retry below."}
                </p>
                {errorSpread?.error_details_json ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[10px] leading-relaxed text-red-200/70">
                    {JSON.stringify(errorSpread.error_details_json, null, 2)}
                  </pre>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void compute()}
              disabled={recomputing || isComputing}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-60"
            >
              <Icon name="sync" className="h-4 w-4" />
              {recomputing ? "Starting…" : "Retry Compute"}
            </button>
          </div>
        </div>
      )}

      {view === "missing" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Icon name="error" className="mt-0.5 h-5 w-5 text-amber-300" />
              <div>
                <h3 className="text-sm font-semibold text-amber-100">
                  Global Cash Flow required
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                  Memo readiness is blocked until global cash flow is computed. GCF
                  aggregates personal income + property NOI − obligations across all
                  entities. It is built from the business and personal financial
                  spreads — if those exist, compute to materialize the global figure;
                  if not, upload the underlying financial documents first.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void compute()}
              disabled={recomputing || isComputing}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-400 disabled:opacity-60"
            >
              <Icon name="sync" className="h-4 w-4" />
              {recomputing ? "Starting…" : "Compute Global Cash Flow"}
            </button>
          </div>
        </div>
      )}

      {view === "ready" && gcfSpread && (
        <>
          {/* KPI cards */}
          {kpis.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div className="text-[10px] uppercase tracking-wide text-white/50">
                    {kpi.label}
                  </div>
                  <div className={cn("mt-1 text-lg font-bold", kpi.color ?? "text-white")}>
                    {kpi.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Full GCF table */}
          <SpreadTable
            title={gcfSpread.rendered_json?.title ?? "Global Cash Flow"}
            subtitle={
              [
                gcfSpread.rendered_json?.asOf ? `As of ${gcfSpread.rendered_json.asOf}` : null,
                `v${gcfSpread.rendered_json?.meta?.version ?? gcfSpread.spread_version}`,
              ]
                .filter(Boolean)
                .join(" · ")
            }
            columns={columns}
            rows={buildGcfRows(gcfSpread)}
          />
        </>
      )}
    </div>
  );
}
