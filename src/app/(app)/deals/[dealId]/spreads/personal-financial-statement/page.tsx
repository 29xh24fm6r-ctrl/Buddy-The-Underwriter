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
  owner_type?: string;
  owner_entity_id?: string | null;
};

const ASSET_SECTIONS = ["ASSETS"];
const LIABILITY_SECTIONS = ["LIABILITIES", "EQUITY", "OBLIGATIONS"];

function buildRows(
  spread: SpreadData,
  filterSections: string[],
): SpreadTableRow[] {
  const rows = spread.rendered_json?.rows;
  if (!Array.isArray(rows)) return [];

  const filtered = rows.filter((r: any) => {
    const section = String(r.section ?? "").toUpperCase();
    return filterSections.some((s) => section.includes(s));
  });

  const result: SpreadTableRow[] = [];
  let lastSection: string | null = null;

  for (const r of filtered) {
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

function extractNetWorth(spread: SpreadData): string {
  const rows = spread.rendered_json?.rows;
  if (!Array.isArray(rows)) return "—";

  const nwRow = rows.find(
    (r: any) => r.key === "PFS_NET_WORTH" || r.key === "NET_WORTH",
  );
  if (!nwRow) return "—";

  const cell = Array.isArray(nwRow.values) ? nwRow.values[0] : null;
  return extractCellValue(cell, nwRow.key);
}

export default function PersonalFinancialStatementPage() {
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
        `/api/deals/${dealId}/spreads?types=PERSONAL_FINANCIAL_STATEMENT&owner_type=PERSONAL`,
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

  const assetColumns: SpreadTableColumn[] = [
    { key: "label", label: "Asset", align: "left" },
    { key: "value", label: "Value", align: "right" },
  ];

  const liabilityColumns: SpreadTableColumn[] = [
    { key: "label", label: "Liability / Equity", align: "left" },
    { key: "value", label: "Value", align: "right" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Personal Financial Statements</h2>
          <p className="mt-0.5 text-xs text-white/50">
            Guarantor balance sheets — assets, liabilities, and net worth (SBA 413 or equivalent).
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
        <div className="py-12 text-center text-xs text-white/50">Loading personal financial statements...</div>
      ) : spreads.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <Icon name="account_balance" className="mx-auto h-8 w-8 text-white/20" />
          <p className="mt-3 text-sm text-white/50">No personal financial statements yet.</p>
          <p className="mt-1 text-xs text-white/30">
            Upload PFS or SBA 413 forms and assign them to a guarantor.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {spreads.map((spread) => {
            const label = ownerLabel(spread);
            const netWorth = extractNetWorth(spread);
            const asOf = spread.rendered_json?.asOf ?? null;

            const assetRows = buildRows(spread, ASSET_SECTIONS);
            const liabilityRows = buildRows(spread, LIABILITY_SECTIONS);

            return (
              <div key={`${spread.spread_type}:${spread.spread_version}:${spread.owner_entity_id ?? "null"}`}>
                {/* Guarantor header with net worth badge */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon name="person" className="h-5 w-5 text-white/40" />
                    <div>
                      <h3 className="text-sm font-semibold text-white">{label}</h3>
                      {asOf && <p className="text-xs text-white/40">As of {asOf}</p>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-white/50">Net Worth</div>
                    <div className="text-sm font-bold text-white">{netWorth}</div>
                  </div>
                </div>

                {/* Split layout: Assets left, Liabilities+NW right */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SpreadTable
                    title="Assets"
                    columns={assetColumns}
                    rows={assetRows}
                    emptyMessage="No asset data available."
                  />
                  <SpreadTable
                    title="Liabilities & Net Worth"
                    columns={liabilityColumns}
                    rows={liabilityRows}
                    emptyMessage="No liability data available."
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
