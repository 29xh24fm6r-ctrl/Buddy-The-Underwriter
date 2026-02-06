"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  MultiPeriodSpreadTable,
  SpreadTable,
  classifyRowKind,
  extractCellValue,
  type SpreadRowKind,
  type SpreadTableColumn,
  type SpreadTableRow,
} from "@/components/deals/spreads/SpreadTable";

type SpreadData = {
  deal_id: string;
  bank_id: string;
  spread_type: string;
  spread_version: number;
  status: string;
  rendered_json: any;
  updated_at: string;
  error: string | null;
  owner_type?: string;
  owner_entity_id?: string | null;
};

const BUSINESS_TYPES = ["T12", "BALANCE_SHEET", "RENT_ROLL"];

function buildSingleColumnRows(spread: SpreadData): SpreadTableRow[] {
  const rows = spread.rendered_json?.rows;
  if (!Array.isArray(rows)) return [];

  const result: SpreadTableRow[] = [];
  let lastSection: string | null = null;

  for (const r of rows) {
    const section = r.section ?? null;

    // Add section header when section changes
    if (section && section !== lastSection) {
      result.push({
        key: `_section_${section}`,
        label: sectionLabel(section),
        section,
        kind: "section_header",
        values: [],
      });
    }
    lastSection = section;

    const kind = classifyRowKind(r);
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

function sectionLabel(section: string): string {
  return section
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildMultiPeriodRows(spread: SpreadData) {
  const rows = spread.rendered_json?.rows;
  const colDefs = spread.rendered_json?.columnsV2;

  if (!Array.isArray(rows) || !Array.isArray(colDefs)) return null;

  const periodColumns = colDefs.map((c: any) => ({
    key: String(c.key),
    label: String(c.label),
    kind: String(c.kind ?? "other"),
  }));

  const tableRows: Array<{
    key: string;
    label: string;
    section?: string | null;
    kind: SpreadRowKind;
    valueByCol: Record<string, string | number | null>;
    displayByCol?: Record<string, string | null>;
    formula?: string | null;
  }> = [];

  let lastSection: string | null = null;

  for (const r of rows) {
    const section = r.section ?? null;
    if (section && section !== lastSection) {
      tableRows.push({
        key: `_section_${section}`,
        label: sectionLabel(section),
        section,
        kind: "section_header",
        valueByCol: {},
      });
    }
    lastSection = section;

    const cell = Array.isArray(r.values) ? r.values[0] : null;
    const valueByCol: Record<string, string | number | null> = {};
    const displayByCol: Record<string, string | null> = {};

    if (cell && typeof cell === "object") {
      for (const col of periodColumns) {
        if (cell.displayByCol?.[col.key] !== undefined) {
          displayByCol[col.key] = cell.displayByCol[col.key];
        }
        if (cell.valueByCol?.[col.key] !== undefined) {
          valueByCol[col.key] = cell.valueByCol[col.key];
        }
      }
    }

    tableRows.push({
      key: r.key,
      label: r.label ?? r.key,
      section,
      kind: classifyRowKind(r),
      valueByCol,
      displayByCol: Object.keys(displayByCol).length ? displayByCol : undefined,
      formula: r.formula ?? null,
    });
  }

  return { periodColumns, rows: tableRows };
}

export default function BusinessSpreadsPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [spreads, setSpreads] = React.useState<SpreadData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [recomputing, setRecomputing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/spreads?types=${BUSINESS_TYPES.join(",")}&owner_type=DEAL`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load spreads");
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

  // Poll while any spread is generating
  React.useEffect(() => {
    const hasGenerating = spreads.some((s) => s.status === "generating");
    if (!hasGenerating) return;
    const id = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(id);
  }, [spreads, load]);

  async function recompute() {
    setRecomputing(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/spreads/recompute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Recompute failed");
      window.setTimeout(() => void load(), 750);
    } catch (e: any) {
      setError(e?.message ?? "Recompute failed");
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Business Spreads</h2>
          <p className="mt-0.5 text-xs text-white/50">
            T12 income statement, balance sheet, and rent roll for the subject property.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void recompute()}
            disabled={recomputing}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
          >
            <Icon name={recomputing ? "pending" : "sync"} className="h-4 w-4" />
            Recompute
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-white/50">Loading business spreads...</div>
      ) : spreads.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Icon name="analytics" className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white/50">No business spreads generated yet.</p>
          <p className="mt-1 text-xs text-white/30">
            Upload financial documents and click Recompute to generate spreads.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {spreads.map((spread) => {
            const title = String(spread.rendered_json?.title ?? spread.spread_type);
            const asOf = spread.rendered_json?.asOf ?? null;
            const subtitle = [
              asOf ? `As of ${asOf}` : null,
              `v${spread.spread_version}`,
              spread.status === "generating" ? "Generating..." : null,
            ]
              .filter(Boolean)
              .join(" · ");

            // Try multi-period first (T12 with columnsV2)
            const multiPeriod = buildMultiPeriodRows(spread);
            if (multiPeriod) {
              return (
                <MultiPeriodSpreadTable
                  key={`${spread.spread_type}:${spread.spread_version}`}
                  title={title}
                  subtitle={subtitle}
                  periodColumns={multiPeriod.periodColumns}
                  rows={multiPeriod.rows}
                />
              );
            }

            // Fallback to single-column layout
            const columns: SpreadTableColumn[] = [
              { key: "label", label: "Line Item", align: "left" },
              { key: "value", label: "Value", align: "right" },
            ];

            return (
              <SpreadTable
                key={`${spread.spread_type}:${spread.spread_version}`}
                title={title}
                subtitle={subtitle}
                columns={columns}
                rows={buildSingleColumnRows(spread)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
