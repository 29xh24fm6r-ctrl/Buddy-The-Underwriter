// src/lib/intelligence/c4FinancialStatementExtract.ts
import "server-only";
import { buildPnLInsights, C4PnLExtract, C4PnLInsights, PnLLineItem } from "./c4PnLInsights";

type Args = { raw: any };

function toStr(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function norm(s: string) {
  return toStr(s).trim().toLowerCase().replace(/\s+/g, " ");
}

function parseMoney(cell: string): number | null {
  const s0 = toStr(cell).trim();
  if (!s0) return null;

  // detect parentheses for negative
  const neg = /^\(.*\)$/.test(s0);

  // strip currency, commas, spaces, parentheses
  const s = s0
    .replace(/[\$,]/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "")
    .replace(/—|–|-/g, "-");

  // allow "1,234.56" already stripped commas
  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  return neg ? -Math.abs(n) : n;
}

function getTables(raw: any): any[] {
  const t = raw?.analyzeResult?.tables;
  return Array.isArray(t) ? t : [];
}

function tableToGrid(table: any): string[][] {
  const rowCount = Number(table?.rowCount ?? 0);
  const colCount = Number(table?.columnCount ?? 0);

  const grid: string[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => "")
  );

  const cells = Array.isArray(table?.cells) ? table.cells : [];
  for (const cell of cells) {
    const r = Number(cell?.rowIndex ?? -1);
    const c = Number(cell?.columnIndex ?? -1);
    const content = toStr(cell?.content ?? "");
    if (r >= 0 && c >= 0 && r < rowCount && c < colCount) {
      // if multiple fragments land in same cell, join
      grid[r][c] = grid[r][c] ? `${grid[r][c]} ${content}`.trim() : content;
    }
  }

  return grid;
}

function looksLikePnLHeaderRow(row: string[]): boolean {
  const joined = norm(row.join(" | "));
  // Common P&L signals
  return (
    joined.includes("profit") ||
    joined.includes("loss") ||
    joined.includes("income statement") ||
    joined.includes("statement of operations") ||
    joined.includes("revenue") ||
    joined.includes("sales") ||
    joined.includes("gross profit") ||
    joined.includes("net income")
  );
}

function scorePnLTable(grid: string[][]): number {
  let score = 0;
  const flat = norm(grid.flat().join(" | "));

  const bumps: Array<[string, number]> = [
    ["profit and loss", 10],
    ["income statement", 10],
    ["statement of operations", 10],
    ["revenue", 6],
    ["sales", 5],
    ["gross profit", 6],
    ["cost of goods", 6],
    ["cogs", 6],
    ["operating", 4],
    ["net income", 6],
    ["expenses", 4],
  ];

  for (const [k, w] of bumps) {
    if (flat.includes(k)) score += w;
  }

  // If it has a first column that looks like labels and at least one numeric column
  const numericCells = grid.flat().filter((c) => parseMoney(c) !== null).length;
  if (numericCells >= 10) score += 5;
  if (numericCells >= 30) score += 5;

  // penalize tiny tables
  if (grid.length < 4) score -= 5;

  return score;
}

function detectPeriods(headerRow: string[]): string[] {
  // periods are typically columns 1..N (col 0 is label)
  const periods: string[] = [];
  for (let i = 1; i < headerRow.length; i++) {
    const h = toStr(headerRow[i]).trim();
    if (!h) continue;
    // Keep as-is, but compact spaces
    periods.push(h.replace(/\s+/g, " "));
  }
  return periods.length ? periods : ["Period"];
}

function isHeaderCandidate(row: string[]): boolean {
  const joined = norm(row.join(" "));
  // if row contains year-like tokens or "month"/"ytd" and minimal numbers, treat as header
  const hasYear = /\b(19|20)\d{2}\b/.test(joined);
  const hasYtd = joined.includes("ytd") || joined.includes("year to date");
  const hasMonth = joined.includes("month") || joined.includes("quarter") || /\bq[1-4]\b/.test(joined);
  const numCount = row.filter((c) => parseMoney(c) !== null).length;
  return (hasYear || hasYtd || hasMonth) && numCount <= 2;
}

function normalizeLabel(label: string): string {
  return norm(label)
    .replace(/[^a-z0-9 %/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sumIfPresent(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function pickTotalsFromLines(periods: string[], lines: PnLLineItem[]) {
  const totals: C4PnLExtract["totals"] = {};

  const findByKeywords = (keywords: string[]): PnLLineItem | null => {
    for (const li of lines) {
      const lab = normalizeLabel(li.label);
      if (keywords.every((k) => lab.includes(k))) return li;
    }
    return null;
  };

  const revenueLI =
    findByKeywords(["total", "revenue"]) ||
    findByKeywords(["total", "sales"]) ||
    findByKeywords(["gross", "revenue"]) ||
    findByKeywords(["sales"]) ||
    findByKeywords(["revenue"]);

  const cogsLI =
    findByKeywords(["cost", "goods"]) ||
    findByKeywords(["cogs"]) ||
    findByKeywords(["cost of sales"]) ||
    findByKeywords(["cost", "sales"]);

  const grossLI = findByKeywords(["gross", "profit"]) || findByKeywords(["gross", "margin"]);

  const opExpLI =
    findByKeywords(["total", "operating", "expense"]) ||
    findByKeywords(["operating", "expenses"]) ||
    findByKeywords(["total", "expenses"]);

  const opIncLI =
    findByKeywords(["operating", "income"]) ||
    findByKeywords(["operating", "profit"]) ||
    findByKeywords(["income from operations"]);

  const netLI =
    findByKeywords(["net", "income"]) ||
    findByKeywords(["net", "profit"]) ||
    findByKeywords(["net", "loss"]) ||
    findByKeywords(["net income (loss)"]);

  const valuesFrom = (li: PnLLineItem | null): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const p of periods) out[p] = li?.values?.[p] ?? null;
    return out;
  };

  if (revenueLI) totals.revenue = valuesFrom(revenueLI);
  if (cogsLI) totals.cogs = valuesFrom(cogsLI);
  if (grossLI) totals.gross_profit = valuesFrom(grossLI);
  if (opExpLI) totals.operating_expense = valuesFrom(opExpLI);
  if (opIncLI) totals.operating_income = valuesFrom(opIncLI);
  if (netLI) totals.net_income = valuesFrom(netLI);

  // If gross profit missing but revenue + cogs exist, compute gross profit
  if (!totals.gross_profit && totals.revenue && totals.cogs) {
    const gp: Record<string, number | null> = {};
    for (const p of periods) {
      gp[p] = sumIfPresent(totals.revenue[p] ?? null, totals.cogs[p] != null ? -(totals.cogs[p] as number) : null);
    }
    totals.gross_profit = gp;
  }

  return totals;
}

export type C4FinancialStatement = {
  kind: "C4_FINANCIAL_STATEMENT";
  statement_type: "PNL";
  pnl: C4PnLExtract;
  insights: C4PnLInsights | null;
};

export async function c4FinancialStatementExtract({ raw }: Args): Promise<C4FinancialStatement | null> {
  const tables = getTables(raw);
  if (!tables.length) return null;

  // pick best table
  let bestIdx = -1;
  let bestScore = -Infinity;
  let bestGrid: string[][] | null = null;

  for (let i = 0; i < tables.length; i++) {
    const grid = tableToGrid(tables[i]);
    const score = scorePnLTable(grid);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
      bestGrid = grid;
    }
  }

  if (!bestGrid || bestIdx < 0 || bestScore < 8) {
    return null;
  }

  // Find header row (prefer explicit header candidates)
  let headerRowIndex = -1;
  for (let r = 0; r < Math.min(bestGrid.length, 8); r++) {
    if (isHeaderCandidate(bestGrid[r]) || looksLikePnLHeaderRow(bestGrid[r])) {
      headerRowIndex = r;
      break;
    }
  }
  if (headerRowIndex < 0) headerRowIndex = 0;

  const headerRow = bestGrid[headerRowIndex] ?? [];
  const periods = detectPeriods(headerRow);

  // Parse line items from rows after header
  const line_items: PnLLineItem[] = [];
  for (let r = headerRowIndex + 1; r < bestGrid.length; r++) {
    const row = bestGrid[r];
    if (!row || row.length < 2) continue;

    const label = toStr(row[0]).trim();
    if (!label) continue;

    // Skip repeated headers / empty-ish label rows
    const labN = normalizeLabel(label);
    if (labN === "amount" || labN === "description") continue;

    const values: Record<string, number | null> = {};
    let any = false;

    for (let c = 1; c < row.length; c++) {
      const p = periods[c - 1] ?? `Col${c}`;
      const val = parseMoney(row[c]);
      values[p] = val;
      if (val !== null) any = true;
    }

    // Only keep rows with at least one numeric cell
    if (!any) continue;

    line_items.push({ label, values });
  }

  if (!line_items.length) return null;

  const pnl: C4PnLExtract = {
    kind: "C4_PNL",
    periods,
    currency_hint: null,
    line_items,
    totals: pickTotalsFromLines(periods, line_items),
    evidence: {
      table_index: bestIdx,
      notes: [`selected_table_score=${bestScore}`],
    },
  };

  const insights = buildPnLInsights(pnl);

  return {
    kind: "C4_FINANCIAL_STATEMENT",
    statement_type: "PNL",
    pnl,
    insights,
  };
}
