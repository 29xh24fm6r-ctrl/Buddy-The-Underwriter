// src/lib/finance/normalize/normalizePnlFromC4.ts

import type { MoodyPnlLine, MoodyPnlPackage, MoodyPnlPeriod } from "@/lib/finance/moody";
import {
  canonicalizePnlLabel,
  PNL_LINE_LABEL,
  PNL_LINE_ORDER,
  type PnlLineId,
} from "@/lib/finance/moody/pnl-line-catalog";

type C4LikeInput = any;

/**
 * Build a MoodyPnlPackage from a C4 (Document Intelligence) normalized structure.
 * IMPORTANT: This function's return type is the contract. Do not change lightly.
 */
export const buildMoodyPackageFromC4 = buildMoodyPnlPackageFromC4;

export default function buildMoodyPnlPackageFromC4(input: C4LikeInput): MoodyPnlPackage {
  const builtAt = new Date().toISOString();
  const warnings: { code: string; message: string }[] = [];

  // UploadBox calls us with { dealId, jobId, c4 }
  const c4 = input?.c4 ?? input;

  const periods = normalizePeriodsFromC4_CommonLayout(c4, warnings);

  // Underwriting QA flags
  for (const p of periods) {
    const hasRevenue = typeof p.revenue === "number";
    const hasNI = typeof p.net_income === "number";
    if (!hasRevenue && hasNI) {
      warnings.push({
        code: "QA_REVENUE_MISSING",
        message: `Period "${p.period_label}": Net income found but revenue missing; mapping likely incomplete.`,
      });
    }
    if (!hasRevenue) {
      warnings.push({
        code: "QA_REVENUE_NOT_FOUND",
        message: `Period "${p.period_label}": Revenue line not confidently identified.`,
      });
    }
  }

  return {
    meta: {
      source: "C4",
      built_at_iso: builtAt,
      schema_version: 1,
    },
    periods,
    warnings: warnings.length ? warnings : undefined,
  };
}

/**
 * Common-layout multi-period extraction:
 * - Row 0 is header row (period labels in cols 1..N)
 * - Col 0 is line item label
 * - Col 1..N are amounts for each period
 */
function normalizePeriodsFromC4_CommonLayout(
  c4: any,
  warnings: { code: string; message: string }[]
): MoodyPnlPeriod[] {
  const tables = c4?.analyzeResult?.tables ?? c4?.tables ?? [];
  if (!Array.isArray(tables) || tables.length === 0) {
    warnings.push({
      code: "NO_TABLES",
      message: "No tables found in C4 payload (analyzeResult.tables missing/empty).",
    });
    return [{ period_label: guessPeriodLabel(c4) ?? "UNKNOWN", lines: [] }];
  }

  const best = pickBestPnlTable(tables);
  if (!best) {
    warnings.push({
      code: "NO_PNL_TABLE",
      message: "Tables found, but no likely P&L table matched heuristics.",
    });
    return [{ period_label: guessPeriodLabel(c4) ?? "UNKNOWN", lines: [] }];
  }

  const grid = tableToGrid(best);
  if (grid.rowCount < 2 || grid.colCount < 2) {
    warnings.push({
      code: "PNL_TABLE_TOO_SMALL",
      message: "Candidate P&L table is too small to contain headers + data.",
    });
    return [{ period_label: guessPeriodLabel(c4) ?? "UNKNOWN", lines: [] }];
  }

  const periodLabels = extractPeriodLabelsFromHeaderRow(grid, warnings);
  if (periodLabels.length === 0) {
    warnings.push({
      code: "NO_PERIOD_HEADERS",
      message: "Could not detect period headers in row 0; falling back to single-period extraction (right-most numeric cell).",
    });
    // fallback: old behavior (single period)
    const rawLinesSingle = linesFromC4Table_RightMostNumeric(best);
    const { canonicalLines, idToAmount } = canonicalizeLines(rawLinesSingle, warnings);
    return [
      {
        period_label: guessPeriodLabel(c4) ?? "UNKNOWN",
        lines: canonicalLines,
        revenue: idToAmount.REVENUE,
        ebitda: idToAmount.EBITDA,
        net_income: idToAmount.NET_INCOME,
      },
    ];
  }

  // Build one period per header column 1..N
  const periods: MoodyPnlPeriod[] = [];

  for (let col = 1; col < grid.colCount; col++) {
    const periodLabel = periodLabels[col - 1] ?? `COL_${col}`;

    const rawLines: Array<{ label: string; amount: number }> = [];
    for (let r = 1; r < grid.rowCount; r++) {
      const label = toCleanLabel(grid.rows[r][0]);
      if (!label) continue;

      const amt = toNumber(grid.rows[r][col]);
      if (amt === null) continue;

      rawLines.push({ label, amount: amt });
    }

    const { canonicalLines, idToAmount } = canonicalizeLines(rawLines, warnings);

    periods.push({
      period_label: periodLabel,
      lines: canonicalLines,
      revenue: idToAmount.REVENUE,
      ebitda: idToAmount.EBITDA,
      net_income: idToAmount.NET_INCOME,
    });
  }

  if (periods.length === 0) {
    warnings.push({
      code: "NO_PERIODS_BUILT",
      message: "Detected headers but produced zero periods (no numeric data parsed).",
    });
    return [{ period_label: guessPeriodLabel(c4) ?? "UNKNOWN", lines: [] }];
  }

  warnings.push({
    code: "PNL_MULTI_PERIOD",
    message: `Extracted ${periods.length} period(s) from header row (common layout).`,
  });

  return periods;
}

function extractPeriodLabelsFromHeaderRow(
  grid: { rows: string[][]; rowCount: number; colCount: number },
  warnings: { code: string; message: string }[]
): string[] {
  // Row 0, cols 1..N are the period labels
  const out: string[] = [];
  for (let c = 1; c < grid.colCount; c++) {
    const raw = String(grid.rows[0][c] ?? "").trim();
    if (!raw) {
      out.push(`Period ${c}`);
      continue;
    }
    // Light cleanup
    out.push(raw.replace(/\s+/g, " "));
  }

  // If everything is blank / generic, treat as failure
  const meaningful = out.some((x) => /fy|ttm|20\d{2}|\d{4}/i.test(x) || x.length >= 3);
  if (!meaningful) {
    warnings.push({
      code: "HEADER_NOT_MEANINGFUL",
      message: "Header row did not look like period labels (FY/TTM/year).",
    });
    return [];
  }
  return out;
}

function pickBestPnlTable(tables: any[]): any | null {
  let best: any = null;
  let bestScore = -1;

  for (const t of tables) {
    const s = scoreTableForPnl(t);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return bestScore > 0 ? best : null;
}

function scoreTableForPnl(t: any): number {
  const text = JSON.stringify(t?.cells ?? t ?? "").toLowerCase();
  let s = 0;
  if (text.includes("revenue") || text.includes("sales")) s += 5;
  if (text.includes("cogs") || text.includes("cost of goods") || text.includes("cost of sales")) s += 3;
  if (text.includes("gross profit")) s += 3;
  if (text.includes("operating") || text.includes("opex") || text.includes("sga")) s += 2;
  if (text.includes("ebitda")) s += 4;
  if (text.includes("net income") || text.includes("net profit") || text.includes("net earnings")) s += 4;
  return s;
}

function tableToGrid(table: any): { rows: string[][]; rowCount: number; colCount: number } {
  const rowCount = Number(table?.rowCount ?? 0);
  const colCount = Number(table?.columnCount ?? 0);

  const grid: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => "")
  );

  const cells = Array.isArray(table?.cells) ? table.cells : [];
  for (const cell of cells) {
    const r = Number(cell?.rowIndex ?? -1);
    const c = Number(cell?.columnIndex ?? -1);
    const content = cell?.content ?? "";
    if (r >= 0 && c >= 0 && r < rowCount && c < colCount) {
      grid[r][c] = String(content);
    }
  }

  return { rows: grid, rowCount, colCount };
}

/**
 * Fallback single-period extractor:
 * For each row, pick right-most numeric cell as "amount".
 */
function linesFromC4Table_RightMostNumeric(t: any): Array<{ label: string; amount: number }> {
  const out: Array<{ label: string; amount: number }> = [];

  const grid = tableToGrid(t);
  if (grid.rowCount === 0 || grid.colCount === 0) return out;

  for (let r = 0; r < grid.rowCount; r++) {
    const label = toCleanLabel(grid.rows[r][0]);
    if (!label) continue;

    let amt: number | null = null;
    for (let c = grid.colCount - 1; c >= 1; c--) {
      const n = toNumber(grid.rows[r][c]);
      if (n !== null) {
        amt = n;
        break;
      }
    }
    if (amt === null) continue;

    out.push({ label, amount: amt });
  }

  return out;
}

function canonicalizeLines(
  raw: Array<{ label: string; amount: number }>,
  warnings: { code: string; message: string }[]
): { canonicalLines: MoodyPnlLine[]; idToAmount: Record<PnlLineId, number | undefined> } {
  const idToAmount: Record<PnlLineId, number | undefined> = {
    REVENUE: undefined,
    COGS: undefined,
    GROSS_PROFIT: undefined,
    OPERATING_EXPENSES: undefined,
    EBITDA: undefined,
    DEPRECIATION_AMORTIZATION: undefined,
    INTEREST_EXPENSE: undefined,
    NET_INCOME: undefined,
    OTHER_INCOME: undefined,
    OTHER_EXPENSE: undefined,
    UNKNOWN: undefined,
  };

  // Keep best match per canonical id (highest confidence; tie -> larger abs amount)
  const bestById: Record<string, { amount: number; conf: number; rawLabel: string }> = {};

  for (const ln of raw) {
    const m = canonicalizePnlLabel(ln.label);
    const key = m.id;

    const prev = bestById[key];
    if (
      !prev ||
      m.confidence > prev.conf ||
      (m.confidence === prev.conf && Math.abs(ln.amount) > Math.abs(prev.amount))
    ) {
      bestById[key] = { amount: ln.amount, conf: m.confidence, rawLabel: ln.label };
    }

    if (m.id !== "UNKNOWN" && m.confidence < 0.75) {
      warnings.push({
        code: "LOW_CONFIDENCE_MAP",
        message: `Mapped "${ln.label}" → "${PNL_LINE_LABEL[m.id]}" with low confidence (${Math.round(
          m.confidence * 100
        )}%).`,
      });
    }
  }

  const canonicalLines: MoodyPnlLine[] = [];

  // Render in canonical order first
  for (const id of PNL_LINE_ORDER) {
    const b = bestById[id];
    if (b) {
      canonicalLines.push({ label: PNL_LINE_LABEL[id], amount: b.amount });
      idToAmount[id] = b.amount;
    }
  }

  // Append some unknowns (optional context)
  if (bestById.UNKNOWN) {
    canonicalLines.push({ label: bestById.UNKNOWN.rawLabel, amount: bestById.UNKNOWN.amount });
  }

  return { canonicalLines, idToAmount };
}

function toCleanLabel(x: any): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s) return null;
  if (/^\(?-?\$?\d[\d,]*(\.\d+)?\)?$/.test(s)) return null;
  return s.replace(/\s+/g, " ");
}

function toNumber(x: any): number | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;

  const s = String(x).trim();
  if (!s) return null;

  // Handle (1,234) negatives
  const neg = /^\(.*\)$/.test(s);

  // Strip currency/commas/space
  const cleaned = s.replace(/[,$]/g, "").replace(/[()]/g, "").replace(/\s+/g, "");
  if (!/\d/.test(cleaned)) return null;

  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function guessPeriodLabel(c4: any): string | null {
  const p =
    c4?.period_label ??
    c4?.period ??
    c4?.meta?.period ??
    c4?.analyzeResult?.documentResults?.[0]?.fields?.Period?.content ??
    c4?.analyzeResult?.documents?.[0]?.fields?.Period?.content;

  if (p === null || p === undefined) return null;
  const s = String(p).trim();
  return s ? s : null;
}
