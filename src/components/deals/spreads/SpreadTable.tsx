"use client";

import { cn } from "@/lib/utils";

/**
 * Row styling rules per the MEGA SPEC:
 * - SOURCE rows: normal weight (fact-backed)
 * - TOTAL rows: bold + light bg
 * - DERIVED rows: italic (computed from other rows)
 * - RATIO rows: % formatted, italic
 * - SECTION_HEADER: uppercase, small, acts as group separator
 */

export type SpreadRowKind = "source" | "total" | "derived" | "ratio" | "section_header";

export type SpreadTableRow = {
  key: string;
  label: string;
  section?: string | null;
  kind: SpreadRowKind;
  /** Pre-formatted values per column (index matches colKeys) */
  values: string[];
  formula?: string | null;
};

export type SpreadTableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

function formatCellValue(raw: any, rowKey: string): string {
  if (raw === null || raw === undefined || raw === "") return "—";

  // Handle RenderedSpreadCellV2 objects
  if (typeof raw === "object" && raw !== null) {
    // Check for display notes first (pre-formatted currency)
    if (typeof raw.notes === "string" && raw.notes) return raw.notes;

    // Multi-column support: check valueByCol
    if (raw.valueByCol) {
      // This is handled at the column level, not here
    }

    const v = raw.value;
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return formatNumber(v, rowKey);
    return String(v);
  }

  if (typeof raw === "number") return formatNumber(raw, rowKey);
  return String(raw);
}

function formatNumber(v: number, rowKey: string): string {
  if (!Number.isFinite(v)) return "—";

  // Ratio/percentage rows
  const isRatio = /RATIO|MARGIN|PCT|DSCR|LTV|COVERAGE/i.test(rowKey);
  const isDscr = /DSCR/i.test(rowKey);
  const isPct = /PCT|RATIO|MARGIN|LTV|COVERAGE/i.test(rowKey);

  if (isDscr) return v.toFixed(2) + "x";
  if (isPct) {
    // Values stored as decimal (0.85) or whole (85)
    const pctVal = Math.abs(v) <= 1 && Math.abs(v) > 0 ? v * 100 : v;
    return pctVal.toFixed(1) + "%";
  }

  // Currency values
  if (Math.abs(v) >= 1000) {
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function rowClasses(kind: SpreadRowKind): string {
  switch (kind) {
    case "total":
      return "font-bold bg-white/[0.04]";
    case "derived":
      return "italic text-white/80";
    case "ratio":
      return "italic text-white/70";
    case "section_header":
      return "uppercase text-[10px] tracking-widest text-white/40 font-semibold";
    case "source":
    default:
      return "text-white/90";
  }
}

export function SpreadTable({
  columns,
  rows,
  title,
  subtitle,
  emptyMessage,
}: {
  columns: SpreadTableColumn[];
  rows: SpreadTableRow[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        {title && <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>}
        <p className="text-xs text-white/50">{emptyMessage ?? "No data available."}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {(title || subtitle) && (
        <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={cn(
                    "border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/60",
                    i === 0 ? "sticky left-0 z-10 text-left" : "text-right",
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const prevSection = i > 0 ? rows[i - 1]?.section : undefined;
              const showDivider = row.section !== prevSection && prevSection !== undefined;

              if (row.kind === "section_header") {
                return (
                  <tr key={row.key}>
                    <td
                      colSpan={columns.length}
                      className="border-b border-white/5 bg-white/[0.02] px-4 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-widest text-white/40"
                    >
                      {row.label}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={row.key}
                  className={cn(
                    "transition-colors hover:bg-white/[0.03]",
                    showDivider && "border-t border-white/10",
                  )}
                >
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={cn(
                        "border-b border-white/5 px-4 py-2",
                        ci === 0
                          ? "sticky left-0 z-10 bg-[#0b0d10] text-left"
                          : "text-right tabular-nums",
                        rowClasses(row.kind),
                      )}
                    >
                      {ci === 0 ? row.label : (row.values[ci - 1] ?? "—")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Multi-period spread table for T12 / Balance Sheet (Excel-like with months as columns).
 */
export function MultiPeriodSpreadTable({
  periodColumns,
  rows,
  title,
  subtitle,
  emptyMessage,
}: {
  periodColumns: Array<{ key: string; label: string; kind?: string }>;
  rows: Array<{
    key: string;
    label: string;
    section?: string | null;
    kind: SpreadRowKind;
    valueByCol: Record<string, string | number | null>;
    displayByCol?: Record<string, string | null>;
    formula?: string | null;
  }>;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        {title && <h3 className="mb-2 text-sm font-semibold text-white">{title}</h3>}
        <p className="text-xs text-white/50">{emptyMessage ?? "No data available."}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {(title || subtitle) && (
        <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3">
          {title && <h3 className="text-sm font-semibold text-white">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/60">
                Line Item
              </th>
              {periodColumns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "border-b border-white/10 bg-white/[0.03] px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide",
                    col.kind === "ttm" || col.kind === "ytd"
                      ? "text-white/80"
                      : "text-white/50",
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const prevSection = i > 0 ? rows[i - 1]?.section : undefined;
              const showDivider = row.section !== prevSection && prevSection !== undefined;

              if (row.kind === "section_header") {
                return (
                  <tr key={row.key}>
                    <td
                      colSpan={periodColumns.length + 1}
                      className="border-b border-white/5 bg-white/[0.02] px-4 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-widest text-white/40"
                    >
                      {row.label}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={row.key}
                  className={cn(
                    "transition-colors hover:bg-white/[0.03]",
                    showDivider && "border-t border-white/10",
                  )}
                >
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-b border-white/5 bg-[#0b0d10] px-4 py-2 text-left",
                      rowClasses(row.kind),
                    )}
                  >
                    {row.label}
                  </td>
                  {periodColumns.map((col) => {
                    const display = row.displayByCol?.[col.key];
                    const val = row.valueByCol[col.key];
                    let text: string;

                    if (display !== undefined && display !== null) {
                      text = display;
                    } else if (typeof val === "number") {
                      text = formatNumber(val, row.key);
                    } else if (val === null || val === undefined) {
                      text = "—";
                    } else {
                      text = String(val);
                    }

                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "border-b border-white/5 px-3 py-2 text-right tabular-nums",
                          rowClasses(row.kind),
                        )}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Shared utilities for transforming API spread data into table-ready structures.
 */

export function classifyRowKind(row: {
  key: string;
  formula?: string | null;
  section?: string | null;
}): SpreadRowKind {
  const k = row.key.toUpperCase();

  // Total rows
  if (k.startsWith("TOTAL_") || k === "NOI" || k === "NET_WORTH" || k === "PFS_NET_WORTH" ||
      k.includes("GLOBAL_CASH_FLOW") || k === "GCF_TOTAL_OBLIGATIONS" || k === "GCF_CASH_AVAILABLE") {
    return "total";
  }

  // Ratio rows
  if (k.includes("RATIO") || k.includes("MARGIN") || k.includes("DSCR") || k.includes("LTV") ||
      k.includes("PCT") || k.includes("COVERAGE")) {
    return "ratio";
  }

  // Derived / formula rows
  if (row.formula) {
    return "derived";
  }

  return "source";
}

export function extractCellValue(cell: any, rowKey: string): string {
  return formatCellValue(cell, rowKey);
}
