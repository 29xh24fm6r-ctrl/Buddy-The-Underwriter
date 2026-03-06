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

export function NormalizedSpreadPanel({ spread }: { spread: NormalizedSpread }) {
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
          <tr className="border-b border-zinc-700 text-left">
            <th className="sticky left-0 z-10 bg-zinc-900 px-3 py-2 text-xs font-semibold uppercase text-zinc-400">
              Line Item
            </th>
            {spread.years.map((year) => (
              <th key={year} className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-400">
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
}: {
  category: string;
  items: NormalizedLineItem[];
  years: number[];
  expandedRows: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={years.length + 1}
          className="bg-zinc-800/50 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400"
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
}: {
  item: NormalizedLineItem;
  years: number[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasAdjustments = years.some(
    (y) => item.values[y]?.adjustments && item.values[y].adjustments.length > 0,
  );

  return (
    <>
      <tr
        className={`border-b border-zinc-800 hover:bg-zinc-800/30 ${hasAdjustments ? "cursor-pointer" : ""}`}
        onClick={hasAdjustments ? onToggle : undefined}
      >
        <td className="sticky left-0 z-10 bg-zinc-900 px-3 py-1.5 text-zinc-200">
          <span className="flex items-center gap-1">
            {hasAdjustments && (
              <span className="text-xs text-zinc-500">{expanded ? "\u25BC" : "\u25B6"}</span>
            )}
            {item.label}
          </span>
        </td>
        {years.map((year) => {
          const cell = item.values[year];
          if (!cell) {
            return (
              <td key={year} className="px-3 py-1.5 text-right text-zinc-500">
                —
              </td>
            );
          }
          const hasAdj = cell.adjustments.length > 0;
          const displayValue = hasAdj ? cell.normalized : cell.reported;
          const trend = cell.trend ? TREND_ICONS[cell.trend] : null;

          return (
            <td key={year} className="px-3 py-1.5 text-right">
              <span className="text-zinc-200">{fmtNum(displayValue)}</span>
              {hasAdj && cell.reported !== cell.normalized && (
                <span className="ml-1 text-xs text-amber-400" title={`Reported: ${fmtNum(cell.reported)}`}>
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
            <tr key={`${year}-adj-${i}`} className="bg-zinc-800/20">
              <td className="sticky left-0 z-10 bg-zinc-900 pl-8 pr-3 py-1 text-xs text-amber-400">
                {adj.label}
              </td>
              {years.map((y) => (
                <td key={y} className="px-3 py-1 text-right text-xs text-amber-400">
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
