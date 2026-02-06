import "server-only";

import React from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SpreadRow = {
  key: string;
  label: string;
  section?: string | null;
  formula?: string | null;
  values?: Array<{ value: number | null; notes?: string | null }>;
};

type RenderedSpread = {
  spread_type: string;
  status: string;
  owner_type?: string;
  owner_entity_id?: string | null;
  rendered_json: {
    columnsV2?: Array<{ key: string; label: string; kind?: string }>;
    rows?: SpreadRow[];
  } | null;
  updated_at: string | null;
};

function classifyRowKind(key: string, formula?: string | null): "source" | "total" | "derived" | "ratio" | "section_header" {
  const k = key.toUpperCase();
  if (k.startsWith("TOTAL_") || k === "NOI" || k === "NET_WORTH" || k === "PFS_NET_WORTH" ||
      k.includes("GLOBAL_CASH_FLOW") || k === "GCF_TOTAL_OBLIGATIONS" || k === "GCF_CASH_AVAILABLE") {
    return "total";
  }
  if (k.includes("RATIO") || k.includes("MARGIN") || k.includes("DSCR") || k.includes("LTV") ||
      k.includes("PCT") || k.includes("COVERAGE")) {
    return "ratio";
  }
  if (formula) return "derived";
  return "source";
}

function formatVal(v: number | null, key: string): string {
  if (v === null || v === undefined) return "\u2014";
  if (!Number.isFinite(v)) return "\u2014";

  const k = key.toUpperCase();
  if (/DSCR/i.test(k)) return v.toFixed(2) + "x";
  if (/PCT|RATIO|MARGIN|LTV|COVERAGE/i.test(k)) {
    const pct = Math.abs(v) <= 1 && Math.abs(v) > 0 ? v * 100 : v;
    return pct.toFixed(1) + "%";
  }
  if (Math.abs(v) >= 1000) {
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function rowClassName(kind: ReturnType<typeof classifyRowKind>): string {
  switch (kind) {
    case "total": return "font-bold bg-gray-50";
    case "derived": return "italic text-gray-600";
    case "ratio": return "italic text-gray-500";
    case "section_header": return "uppercase text-[10px] tracking-widest text-gray-400 font-semibold";
    default: return "";
  }
}

const SPREAD_LABELS: Record<string, string> = {
  T12: "Trailing 12 Income Statement",
  BALANCE_SHEET: "Balance Sheet",
  RENT_ROLL: "Rent Roll Summary",
  GLOBAL_CASH_FLOW: "Global Cash Flow",
  PERSONAL_INCOME: "Personal Income",
  PERSONAL_FINANCIAL_STATEMENT: "Personal Financial Statement",
};

export default async function SpreadsAppendix({
  dealId,
  bankId,
}: {
  dealId: string;
  bankId: string;
}) {
  const sb = supabaseAdmin();

  const { data: spreadRows } = await (sb as any)
    .from("deal_spreads")
    .select("spread_type, status, owner_type, owner_entity_id, rendered_json, updated_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("status", "complete")
    .order("updated_at", { ascending: false })
    .limit(20);

  const spreads = (spreadRows ?? []) as RenderedSpread[];

  if (spreads.length === 0) {
    return null;
  }

  // Deduplicate by spread_type + owner_entity_id (keep latest)
  const seen = new Set<string>();
  const uniqueSpreads: RenderedSpread[] = [];
  for (const s of spreads) {
    const dedup = `${s.spread_type}|${s.owner_entity_id ?? ""}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    uniqueSpreads.push(s);
  }

  // Sort: DEAL first, then PERSONAL, then GLOBAL
  const typeOrder = ["T12", "BALANCE_SHEET", "RENT_ROLL", "PERSONAL_INCOME", "PERSONAL_FINANCIAL_STATEMENT", "GLOBAL_CASH_FLOW"];
  uniqueSpreads.sort((a, b) => {
    const ai = typeOrder.indexOf(a.spread_type);
    const bi = typeOrder.indexOf(b.spread_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <div className="text-xs font-semibold uppercase text-gray-600 mb-3">Appendix: Financial Spreads</div>

      <div className="space-y-4">
        {uniqueSpreads.map((spread, si) => {
          const json = spread.rendered_json;
          if (!json?.rows?.length) return null;

          const label = SPREAD_LABELS[spread.spread_type] ?? spread.spread_type;
          const ownerSuffix = spread.owner_entity_id
            ? ` (${String(spread.owner_entity_id).slice(0, 8)}...)`
            : "";

          const hasColumns = json.columnsV2 && json.columnsV2.length > 0;
          const columns = json.columnsV2 ?? [];

          return (
            <div key={`${spread.spread_type}-${spread.owner_entity_id ?? si}`} className="border border-gray-200 rounded-md overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                <div className="text-xs font-semibold text-gray-700">
                  {label}{ownerSuffix}
                </div>
                {spread.updated_at && (
                  <div className="text-[10px] text-gray-400">
                    Updated: {spread.updated_at.slice(0, 10)}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                        Line Item
                      </th>
                      {hasColumns ? (
                        columns.map((col) => (
                          <th
                            key={col.key}
                            className="text-right px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100"
                          >
                            {col.label}
                          </th>
                        ))
                      ) : (
                        <th className="text-right px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                          Value
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {json.rows.map((row) => {
                      const kind = classifyRowKind(row.key, row.formula);

                      if (kind === "section_header") {
                        const colCount = hasColumns ? columns.length + 1 : 2;
                        return (
                          <tr key={row.key}>
                            <td
                              colSpan={colCount}
                              className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400 border-b border-gray-50"
                            >
                              {row.label}
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={row.key} className={rowClassName(kind)}>
                          <td className="px-3 py-1 border-b border-gray-50 text-gray-700">
                            {row.label}
                          </td>
                          {hasColumns ? (
                            columns.map((col, ci) => {
                              const cell = row.values?.[ci];
                              let text = "\u2014";
                              if (cell) {
                                if (cell.notes) text = cell.notes;
                                else text = formatVal(cell.value, row.key);
                              }
                              return (
                                <td key={col.key} className="px-2 py-1 text-right tabular-nums border-b border-gray-50">
                                  {text}
                                </td>
                              );
                            })
                          ) : (
                            <td className="px-3 py-1 text-right tabular-nums border-b border-gray-50">
                              {row.values?.[0]
                                ? (row.values[0].notes ?? formatVal(row.values[0].value, row.key))
                                : "\u2014"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
