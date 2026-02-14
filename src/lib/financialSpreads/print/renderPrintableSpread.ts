/**
 * Printable Spread HTML Renderer
 *
 * Generates a complete HTML document for landscape PDF rendering via Playwright.
 * Institutional formatting: zebra striping, bold totals, right-aligned numbers.
 */

import type { RenderedSpread, SpreadColumnV2 } from "@/lib/financialSpreads/types";

export type PrintMetadata = {
  dealName: string;
  bankName: string;
  date: string;
  preparedBy?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return escapeHtml(v);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function renderPrintableSpread(
  spread: RenderedSpread,
  metadata: PrintMetadata,
): string {
  const columns: SpreadColumnV2[] = spread.columnsV2 ?? [];
  const colKeys = columns.map((c) => c.key);
  const generatedAt = spread.generatedAt ?? new Date().toISOString();

  // Classify rows
  const rows = spread.rows ?? [];

  let tableHtml = "";

  // Header row
  tableHtml += `<thead><tr>
    <th class="label-col">Line Item</th>
    ${colKeys.map((_, i) => `<th class="value-col">${escapeHtml(columns[i]?.label ?? "")}</th>`).join("")}
  </tr></thead>`;

  tableHtml += "<tbody>";
  let rowIdx = 0;

  for (const row of rows) {
    const isSectionHeader = row.notes === "section_header" || row.key.startsWith("_header_");
    const isTotal = /^TOTAL_|^NET_WORTH$|^NET_INCOME$/.test(row.key);
    const isRatio = row.formula && /MARGIN|RATIO|DSCR|LTV|YIELD|COVERAGE|CAP_RATE/.test(row.formula);

    if (isSectionHeader) {
      tableHtml += `<tr class="section-header">
        <td colspan="${colKeys.length + 1}" class="section-label">${escapeHtml(row.label)}</td>
      </tr>`;
      continue;
    }

    const zebraClass = rowIdx % 2 === 0 ? "even" : "odd";
    const totalClass = isTotal ? " total-row" : "";
    const ratioClass = isRatio ? " ratio-row" : "";
    rowIdx++;

    const cell = Array.isArray(row.values) ? row.values[0] : null;
    const hasMulti = cell && typeof cell === "object" && "displayByCol" in cell;

    tableHtml += `<tr class="${zebraClass}${totalClass}${ratioClass}">
      <td class="label-col">${escapeHtml(row.label)}</td>`;

    for (const colKey of colKeys) {
      let display = "—";
      if (hasMulti && (cell as any).displayByCol?.[colKey]) {
        display = escapeHtml(String((cell as any).displayByCol[colKey]));
      } else if (hasMulti && (cell as any).valueByCol?.[colKey] !== undefined) {
        display = formatNumber((cell as any).valueByCol[colKey]);
      }
      tableHtml += `<td class="value-col">${display}</td>`;
    }

    tableHtml += "</tr>";
  }

  tableHtml += "</tbody>";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Financial Analysis — ${escapeHtml(metadata.dealName)}</title>
  <style>
    @page {
      size: letter landscape;
      margin: 0.6in 0.5in 0.7in 0.5in;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 9px;
      color: #1a1a1a;
      line-height: 1.4;
      background: white;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .page-header h1 {
      font-size: 16px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .page-header .meta {
      text-align: right;
      font-size: 8px;
      color: #666;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group;
    }

    thead tr {
      background: #1a1a1a;
    }
    thead th {
      color: white;
      font-size: 8px;
      font-weight: 600;
      padding: 4px 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    tbody tr {
      page-break-inside: avoid;
    }

    td {
      padding: 3px 6px;
      border-bottom: 1px solid #e5e5e5;
      font-size: 9px;
    }

    .label-col {
      text-align: left;
      white-space: nowrap;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .value-col {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    tr.even td { background: #ffffff; }
    tr.odd td { background: #f9f9f9; }

    tr.total-row td {
      font-weight: 700;
      border-top: 1px solid #999;
      border-bottom: 2px solid #1a1a1a;
      background: #f0f0f0 !important;
    }

    tr.ratio-row td {
      font-style: italic;
      color: #555;
    }

    .section-header td {
      background: #e8e8e8 !important;
      font-weight: 700;
      font-size: 10px;
      padding: 6px;
      border-bottom: 1px solid #ccc;
      letter-spacing: 0.3px;
    }

    .page-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 4px 0.5in;
      font-size: 7px;
      color: #999;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e5e5e5;
    }
  </style>
</head>
<body>
  <div class="page-header">
    <div>
      <h1>Financial Analysis</h1>
      <div style="font-size: 11px; color: #444; margin-top: 2px;">${escapeHtml(metadata.dealName)}</div>
    </div>
    <div class="meta">
      <div>${escapeHtml(metadata.bankName)}</div>
      <div>Prepared: ${escapeHtml(metadata.date)}</div>
      ${metadata.preparedBy ? `<div>By: ${escapeHtml(metadata.preparedBy)}</div>` : ""}
    </div>
  </div>

  <table>
    ${tableHtml}
  </table>

  <div class="page-footer">
    <span>CONFIDENTIAL — For Internal Use Only</span>
    <span>Generated ${new Date(generatedAt).toLocaleString("en-US")}</span>
  </div>
</body>
</html>`;
}
