"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  SpreadTable,
  extractCellValue,
  type SpreadTableColumn,
  type SpreadTableRow,
} from "@/components/deals/spreads/SpreadTable";
import { cn } from "@/lib/utils";
import type { CanonicalGcfResult } from "@/lib/financialFacts/canonicalGcfCore";

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

/** KPIs from the canonical selector — used when no full ready spread row exists
 *  but the canonical fact is materialized (state current/legacy_fallback). */
function kpisFromCanonical(c: CanonicalGcfResult): KpiValue[] {
  const kpis: KpiValue[] = [];
  if (typeof c.value === "number") {
    kpis.push({
      label: "Global Cash Flow",
      value: formatCompact(c.value),
      color: c.value >= 0 ? "text-emerald-400" : "text-red-400",
    });
  }
  if (typeof c.gcfDscr === "number") {
    kpis.push({
      label: "Global DSCR",
      value: c.gcfDscr.toFixed(2) + "x",
      color: c.gcfDscr >= 1.25 ? "text-emerald-400" : c.gcfDscr >= 1.0 ? "text-amber-400" : "text-red-400",
    });
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

type View = "loading" | "computing" | "ready" | "error" | "missing";

export default function GlobalCashFlowPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [canonical, setCanonical] = React.useState<CanonicalGcfResult | null>(null);
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
      // SPEC-GCF-SYSTEM-WIDE-PERMANENT-FIX-1: read the CANONICAL GCF contract as
      // the page's state source (state/value/diagnostics) — not only raw
      // deal_spreads rows — so page state can never disagree with memo readiness
      // or the credit memo. The raw spread rows are still returned for rendering
      // the full ready table.
      const res = await fetch(`/api/deals/${dealId}/spreads?canonical=gcf`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load global cash flow");
      setCanonical((json.canonical ?? null) as CanonicalGcfResult | null);
      setSpreads(Array.isArray(json.spreads) ? (json.spreads as SpreadData[]) : []);
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
      // Reload picks up the "queued" state immediately; the poll effect below
      // keeps refreshing through queued → generating → current/error.
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

  // The canonical state is authoritative for "is a compute in flight". We also
  // OR in the raw spread rows (spreads.some(isActiveSpread)) so a freshly-queued
  // row that hasn't yet propagated into the canonical state still polls.
  const computingState =
    canonical?.state === "queued" || canonical?.state === "generating";
  const isComputing = computingState || spreads.some(isActiveSpread);

  React.useEffect(() => {
    if (!isComputing) return;
    const id = window.setInterval(() => void load(), 6_000);
    return () => window.clearInterval(id);
  }, [isComputing, load]);

  const columns: SpreadTableColumn[] = [
    { key: "label", label: "Line Item", align: "left" },
    { key: "value", label: "Amount", align: "right" },
  ];

  // The displayable result: a spread row that actually carries the GCF figure.
  // Prefer the canonical GLOBAL owner_type, then most recently updated.
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

  // SPEC-GCF-SYSTEM-WIDE-PERMANENT-FIX-1: VIEW is derived from the canonical
  // selector state — the single source of truth — not re-derived from raw rows.
  // A canonical "current"/"legacy_fallback" is ready even if the original spread
  // row was superseded; "queued"/"generating" can NEVER read as missing.
  const hasReadyValue =
    canonical?.state === "current" ||
    canonical?.state === "legacy_fallback" ||
    !!readySpread;

  const view: View = loading
    ? "loading"
    : isComputing
    ? "computing"
    : hasReadyValue
    ? "ready"
    : canonical?.state === "error" || errorSpread
    ? "error"
    : "missing";

  const kpis =
    view === "ready"
      ? readySpread
        ? extractGcfKpis(readySpread)
        : canonical
        ? kpisFromCanonical(canonical)
        : []
      : [];

  const diagnostics = canonical?.diagnostics ?? [];
  const warnings = canonical?.warnings ?? [];

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

      {/* Legacy-fallback warning: canonical value resolved from the deprecated
          GLOBAL_CASH_FLOW alias rather than GCF_GLOBAL_CASH_FLOW. */}
      {view === "ready" && warnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
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
                  {errorSpread?.error_code ? `${errorSpread.error_code}: ` : ""}
                  {errorSpread?.error ??
                    diagnostics[0] ??
                    "The computation did not complete. Retry below."}
                </p>
                {/* Precise upstream diagnostics from the canonical selector — never
                    a generic "upload docs". */}
                {diagnostics.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-red-200/80">
                    {diagnostics.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
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
                  entities. Compute to materialize the global figure; if any upstream
                  facts are missing, the specific gaps are listed below.
                </p>
                {/* SPEC-GCF-SYSTEM-WIDE-PERMANENT-FIX-1: precise missing-prerequisite
                    diagnostics from the canonical selector instead of a vague
                    "upload documents". */}
                {diagnostics.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/70">
                      Missing prerequisites
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-200/80">
                      {diagnostics.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
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

      {view === "ready" && (
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

          {/* Full GCF table — only when a ready spread row carries the detail. */}
          {readySpread && (
            <SpreadTable
              title={readySpread.rendered_json?.title ?? "Global Cash Flow"}
              subtitle={
                [
                  readySpread.rendered_json?.asOf ? `As of ${readySpread.rendered_json.asOf}` : null,
                  `v${readySpread.rendered_json?.meta?.version ?? readySpread.spread_version}`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              columns={columns}
              rows={buildGcfRows(readySpread)}
            />
          )}
        </>
      )}
    </div>
  );
}
