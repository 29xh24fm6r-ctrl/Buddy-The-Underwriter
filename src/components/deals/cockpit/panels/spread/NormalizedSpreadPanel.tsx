"use client";

import { useState } from "react";
import type { NormalizedSpread, NormalizedLineItem } from "@/lib/spreadOutput/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Operating Expenses",
  ebitda: "EBITDA / Cash Flow",
  debt_service: "Debt Service",
  ratio: "Key Ratios",
  balance_sheet: "Balance Sheet",
};

const TREND_ICONS: Record<string, { icon: string; color: string }> = {
  up: { icon: "\u2191", color: "text-green-400" },
  down: { icon: "\u2193", color: "text-red-400" },
  flat: { icon: "\u2192", color: "text-zinc-400" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NormalizedSpreadPanel({ spread, theme = "dark" }: { spread: NormalizedSpread; theme?: "dark" | "light" }) {
  const light = theme === "light";
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Group line items by category
  const grouped = groupByCategory(spread.line_items);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b text-left ${light ? "border-gray-200" : "border-zinc-700"}`}>
            <th className={`sticky left-0 z-10 px-3 py-2 text-xs font-semibold uppercase ${light ? "bg-white text-gray-500" : "bg-zinc-900 text-zinc-400"}`}>
              Line Item
            </th>
            {spread.years.map((year) => (
              <th key={year} className={`px-3 py-2 text-right text-xs font-semibold uppercase ${light ? "text-gray-500" : "text-zinc-400"}`}>
                {year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map(([category, items]) => (
            <CategorySection
              key={category}
              category={category}
              items={items}
              years={spread.years}
              expandedRows={expandedRows}
              onToggle={toggleRow}
              light={light}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategorySection({
  category,
  items,
  years,
  expandedRows,
  onToggle,
  light = false,
}: {
  category: string;
  items: NormalizedLineItem[];
  years: number[];
  expandedRows: Set<string>;
  onToggle: (key: string) => void;
  light?: boolean;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={years.length + 1}
          className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${light ? "bg-gray-50 text-gray-500" : "bg-zinc-800/50 text-zinc-400"}`}
        >
          {CATEGORY_LABELS[category] ?? category}
        </td>
      </tr>
      {items.map((item) => (
        <LineItemRow
          key={item.canonical_key}
          item={item}
          years={years}
          expanded={expandedRows.has(item.canonical_key)}
          onToggle={() => onToggle(item.canonical_key)}
          light={light}
        />
      ))}
    </>
  );
}

function LineItemRow({
  item,
  years,
  expanded,
  onToggle,
  light = false,
}: {
  item: NormalizedLineItem;
  years: number[];
  expanded: boolean;
  onToggle: () => void;
  light?: boolean;
}) {
  const hasAdjustments = years.some(
    (y) => item.values[y]?.adjustments && item.values[y].adjustments.length > 0,
  );

  return (
    <>
      <tr
        className={`border-b ${light ? "border-gray-100 hover:bg-gray-50" : "border-zinc-800 hover:bg-zinc-800/30"} ${hasAdjustments ? "cursor-pointer" : ""}`}
        onClick={hasAdjustments ? onToggle : undefined}
      >
        <td className={`sticky left-0 z-10 px-3 py-1.5 ${light ? "bg-white text-gray-800" : "bg-zinc-900 text-zinc-200"}`}>
          <span className="flex items-center gap-1">
            {hasAdjustments && (
              <span className={`text-xs ${light ? "text-gray-400" : "text-zinc-500"}`}>{expanded ? "\u25BC" : "\u25B6"}</span>
            )}
            {item.label}
          </span>
        </td>
        {years.map((year) => {
          const cell = item.values[year];
          if (!cell) {
            return (
              <td key={year} className={`px-3 py-1.5 text-right ${light ? "text-gray-400" : "text-zinc-500"}`}>
                —
              </td>
            );
          }
          const hasAdj = cell.adjustments.length > 0;
          const displayValue = hasAdj ? cell.normalized : cell.reported;
          const trend = cell.trend ? TREND_ICONS[cell.trend] : null;

          return (
            <td key={year} className="px-3 py-1.5 text-right">
              <span className={light ? "text-gray-800" : "text-zinc-200"}>{fmtNum(displayValue)}</span>
              {hasAdj && cell.reported !== cell.normalized && (
                <span className={`ml-1 text-xs ${light ? "text-amber-600" : "text-amber-400"}`} title={`Reported: ${fmtNum(cell.reported)}`}>
                  *
                </span>
              )}
              {trend && (
                <span className={`ml-1 text-xs ${trend.color}`} title={cell.trend_pct != null ? `${(cell.trend_pct * 100).toFixed(1)}%` : ""}>
                  {trend.icon}
                </span>
              )}
            </td>
          );
        })}
      </tr>

      {/* Adjustment detail rows */}
      {expanded &&
        years.map((year) => {
          const cell = item.values[year];
          if (!cell?.adjustments?.length) return null;
          return cell.adjustments.map((adj, i) => (
            <tr key={`${year}-adj-${i}`} className={light ? "bg-amber-50/50" : "bg-zinc-800/20"}>
              <td className={`sticky left-0 z-10 pl-8 pr-3 py-1 text-xs ${light ? "bg-white text-amber-600" : "bg-zinc-900 text-amber-400"}`}>
                {adj.label}
              </td>
              {years.map((y) => (
                <td key={y} className={`px-3 py-1 text-right text-xs ${light ? "text-amber-600" : "text-amber-400"}`}>
                  {y === year ? fmtNum(adj.amount) : ""}
                </td>
              ))}
            </tr>
          ));
        })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupByCategory(items: NormalizedLineItem[]): [string, NormalizedLineItem[]][] {
  const map = new Map<string, NormalizedLineItem[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries());
}

function fmtNum(val: number | null): string {
  if (val === null || val === undefined) return "—";
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  if (Math.abs(val) < 10 && val !== 0) return val.toFixed(2);
  return val.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
