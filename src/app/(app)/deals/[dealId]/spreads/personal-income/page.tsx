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

type SpreadData = {
  spread_type: string;
  spread_version: number;
  status: string;
  rendered_json: any;
  updated_at: string;
  error: string | null;
  owner_type?: string;
  owner_entity_id?: string | null;
};

function buildRows(spread: SpreadData): SpreadTableRow[] {
  const rows = spread.rendered_json?.rows;
  if (!Array.isArray(rows)) return [];

  const result: SpreadTableRow[] = [];
  let lastSection: string | null = null;

  for (const r of rows) {
    const section = r.section ?? null;

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

function ownerLabel(spread: SpreadData): string {
  const meta = spread.rendered_json?.meta;
  const oid = meta?.owner_entity_id ?? spread.owner_entity_id;
  if (oid) return `Guarantor ${String(oid).slice(0, 8)}...`;
  return "Primary Guarantor";
}

export default function PersonalIncomePage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params?.dealId ?? "";
  const [spreads, setSpreads] = React.useState<SpreadData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/spreads?types=PERSONAL_INCOME&owner_type=PERSONAL`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load spreads");
      setSpreads(Array.isArray(json.spreads) ? json.spreads : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const hasGenerating = spreads.some((s) => s.status === "generating");
    if (!hasGenerating) return;
    const id = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(id);
  }, [spreads, load]);

  const columns: SpreadTableColumn[] = [
    { key: "label", label: "Income Source", align: "left" },
    { key: "value", label: "Annual Amount", align: "right" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Personal Income Spreads</h2>
          <p className="mt-0.5 text-xs text-white/50">
            Sponsor/guarantor personal income from tax returns (1040), grouped by individual.
          </p>
        </div>
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

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-xs text-white/50">Loading personal income spreads...</div>
      ) : spreads.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Icon name="person" className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white/50">No personal income spreads yet.</p>
          <p className="mt-1 text-xs text-white/30">
            Upload personal tax returns (1040) and assign them to a guarantor to generate spreads.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {spreads.map((spread) => {
            const label = ownerLabel(spread);
            const asOf = spread.rendered_json?.asOf ?? null;
            const subtitle = asOf ? `Tax year ending ${asOf}` : undefined;

            return (
              <SpreadTable
                key={`${spread.spread_type}:${spread.spread_version}:${spread.owner_entity_id ?? "null"}`}
                title={label}
                subtitle={subtitle}
                columns={columns}
                rows={buildRows(spread)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
