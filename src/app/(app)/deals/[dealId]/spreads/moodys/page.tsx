"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  MultiPeriodSpreadTable,
  classifyRowKind,
  type SpreadRowKind,
} from "@/components/deals/spreads/SpreadTable";
import { SpreadViewModelTable } from "@/components/deals/spreads/SpreadViewModelTable";
import type { SpreadViewModel } from "@/lib/modelEngine/renderer/types";

type MoodysSpread = {
  schema_version: number;
  title: string;
  spread_type: string;
  status: string;
  generatedAt: string;
  columns: string[];
  columnsV2: Array<{ key: string; label: string; kind: string }>;
  rows: Array<{
    key: string;
    label: string;
    section?: string | null;
    values: any[];
    formula?: string | null;
    notes?: string | null;
  }>;
  meta?: Record<string, any>;
};

type StatementGroup = {
  key: string;
  label: string;
  rows: Array<{
    key: string;
    label: string;
    section?: string | null;
    kind: SpreadRowKind;
    valueByCol: Record<string, string | number | null>;
    displayByCol?: Record<string, string | null>;
    formula?: string | null;
  }>;
};

function groupByStatement(
  spread: MoodysSpread,
): { periodColumns: Array<{ key: string; label: string; kind: string }>; groups: StatementGroup[] } {
  const periodColumns = (spread.columnsV2 ?? []).map((c) => ({
    key: String(c.key),
    label: String(c.label),
    kind: String(c.kind ?? "other"),
  }));

  const groups: StatementGroup[] = [];
  let currentGroup: StatementGroup | null = null;

  for (const r of spread.rows) {
    // Detect section headers (injected by renderer)
    if (r.notes === "section_header" || r.key.startsWith("_header_")) {
      currentGroup = { key: r.key, label: r.label, rows: [] };
      groups.push(currentGroup);
      continue;
    }

    if (!currentGroup) {
      currentGroup = { key: "_default", label: "Financial Data", rows: [] };
      groups.push(currentGroup);
    }

    const cell = Array.isArray(r.values) ? r.values[0] : null;
    const valueByCol: Record<string, string | number | null> = {};
    const displayByCol: Record<string, string | null> = {};

    if (cell && typeof cell === "object") {
      for (const col of periodColumns) {
        if (cell.valueByCol?.[col.key] !== undefined) {
          valueByCol[col.key] = cell.valueByCol[col.key];
        }
        if (cell.displayByCol?.[col.key] !== undefined) {
          displayByCol[col.key] = cell.displayByCol[col.key];
        }
      }
    }

    // Determine row kind from section name
    const kind = classifyRowKind(r);

    currentGroup.rows.push({
      key: r.key,
      label: r.label,
      section: r.section,
      kind,
      valueByCol,
      displayByCol: Object.keys(displayByCol).length ? displayByCol : undefined,
      formula: r.formula ?? null,
    });
  }

  return { periodColumns, groups };
}

export default function MoodysSpreadPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [spread, setSpread] = React.useState<MoodysSpread | null>(null);
  const [viewModel, setViewModel] = React.useState<SpreadViewModel | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/spreads/moodys`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load financial analysis");
      setSpread(json.spread ?? null);
      setViewModel(json.viewModel ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load financial analysis");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function toggleCollapse(groupKey: string) {
    setCollapsed((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
        </div>
        <div className="py-12 text-center text-xs text-white/50">Loading financial analysis...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Retry
          </button>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      </div>
    );
  }

  // V2 Model Engine path: when API returns a viewModel, render with SpreadViewModelTable
  const useV2 = viewModel !== null && viewModel.sections?.length > 0;

  if (!useV2 && (!spread || !spread.rows?.length)) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Icon name="fact_check" className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white/50">No financial analysis data available yet.</p>
          <p className="mt-1 text-xs text-white/30">
            Upload financial documents and ensure spreads are computed to populate the financial analysis.
          </p>
        </div>
      </div>
    );
  }

  const meta = useV2
    ? { row_count: viewModel!.meta.rowCount, period_count: viewModel!.meta.periodCount }
    : (spread?.meta ?? {}) as Record<string, any>;
  const generatedAt = useV2 ? viewModel!.generatedAt : spread?.generatedAt;
  const validationErrors = !useV2 ? ((spread?.meta as any)?.validation_errors ?? []) : [];

  // Legacy path: group rows for MultiPeriodSpreadTable
  const legacy = !useV2 && spread ? groupByStatement(spread) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Financial Analysis</h2>
          <p className="mt-0.5 text-xs text-white/50">
            {meta.row_count ?? 0} line items &middot; {meta.period_count ?? 1} period{(meta.period_count ?? 1) > 1 ? "s" : ""} &middot; Generated {generatedAt ? new Date(generatedAt).toLocaleDateString() : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
          >
            <Icon name="refresh" className="h-4 w-4" />
            Refresh
          </button>
          <a
            href={`/api/deals/${dealId}/spreads/moodys/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary/90"
          >
            <Icon name="file" className="h-4 w-4" />
            Export PDF
          </a>
        </div>
      </div>

      {/* Validation warnings (non-blocking, legacy path only) */}
      {Array.isArray(validationErrors) && validationErrors.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-xs font-semibold text-amber-300">
            {validationErrors.length} metric{validationErrors.length > 1 ? "s" : ""} missing or incomplete
          </p>
          <p className="mt-1 text-xs text-amber-300/70">
            {(validationErrors as Array<{ metric: string }>).map((e: { metric: string }) => e.metric).join(", ")}
          </p>
          <p className="mt-1 text-xs text-amber-300/50">
            Complete pricing and loan setup to resolve.
          </p>
        </div>
      )}

      {/* V2 path: SpreadViewModelTable */}
      {useV2 && <SpreadViewModelTable viewModel={viewModel!} />}

      {/* Legacy path: grouped MultiPeriodSpreadTable sections */}
      {!useV2 && legacy && legacy.groups.map((group) => {
        const isCollapsed = collapsed[group.key] ?? false;

        return (
          <div key={group.key} className="rounded-xl border border-white/10 bg-white/[0.02]">
            <button
              type="button"
              onClick={() => toggleCollapse(group.key)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-white">{group.label}</span>
              <Icon
                name={isCollapsed ? "chevron_right" : "chevron_left"}
                className="h-5 w-5 text-white/50"
              />
            </button>

            {!isCollapsed && group.rows.length > 0 && (
              <div className="border-t border-white/5">
                <MultiPeriodSpreadTable
                  title=""
                  subtitle=""
                  periodColumns={legacy.periodColumns}
                  rows={group.rows}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
