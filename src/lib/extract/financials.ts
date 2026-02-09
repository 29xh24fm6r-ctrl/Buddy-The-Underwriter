import fs from "fs/promises";

/**
 * Parse PDF buffer into plain text using pdf-parse v2.x class API.
 * Handles the ESM dynamic import and Uint8Array conversion.
 */
async function parsePdfText(buf: Buffer): Promise<{ text: string }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  return { text: result.text ?? "" };
}

type Evidence = {
  id: string;
  docId: string;
  docName: string;
  docType: string;
  page?: number; // not available via pdf-parse; reserved
  field?: string;
  table?: string;
  excerpt?: string;
  value?: string | number;
  confidence?: number; // 0-1
};

type Table = {
  name: string;
  columns: string[];
  rows: Array<Array<string | number>>;
};

export type FinancialsExtract = {
  fields: Record<string, any>;
  tables: Table[];
  evidence: Evidence[];
};

function norm(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const isParenNeg = /\(.*\)/.test(raw);
  const cleaned = raw
    .replace(/\$/g, "")
    .replace(/[,\s]/g, "")
    .replace(/[()]/g, "");
  if (!cleaned || isNaN(Number(cleaned))) return null;
  const n = Number(cleaned);
  return isParenNeg ? -Math.abs(n) : n;
}

// Returns numeric tokens on a line (in order) + their raw strings
function extractNumericTokens(line: string): Array<{ raw: string; value: number }> {
  // Capture things like 1,234 or (1,234) or 1,234.56 or -1,234
  const re = /(\(?-?\$?[\d]{1,3}(?:,[\d]{3})*(?:\.\d+)?\)?)/g;
  const out: Array<{ raw: string; value: number }> = [];
  const matches = line.match(re) ?? [];
  for (const m of matches) {
    const v = parseNumber(m);
    if (v !== null) out.push({ raw: m, value: v });
  }
  return out;
}

function stripTrailingNumbers(line: string) {
  // Remove trailing numeric region to isolate the label
  // Example: "Revenue 1,000 2,000" -> "Revenue"
  return norm(line.replace(/(\(?-?\$?[\d]{1,3}(?:,[\d]{3})*(?:\.\d+)?\)?\s*)+$/g, ""));
}

function looksLikePeriodToken(tok: string): boolean {
  const t = tok.trim();
  if (!t) return false;

  // years 2018-2035
  const y = t.match(/^(20\d{2})$/);
  if (y) return true;

  // FY2023 or FY 2023
  if (/^FY\s?20\d{2}$/i.test(t)) return true;

  // TTM, LTM
  if (/^(TTM|LTM)$/i.test(t)) return true;

  // Q1 2024, 1Q24
  if (/^(Q[1-4]\s?20\d{2}|[1-4]Q\d{2})$/i.test(t)) return true;

  // 6M, 12M (rare)
  if (/^(\d{1,2}M)$/i.test(t)) return true;

  return false;
}

function extractPeriodHeaderCandidates(line: string): string[] {
  // Pull tokens that might represent columns
  const toks = line.split(" ").map((x) => x.trim()).filter(Boolean);

  // Keep period-looking tokens; also allow "FY" then "2023" pattern
  const periods: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    const b = toks[i + 1];

    if (looksLikePeriodToken(a)) periods.push(a.toUpperCase());
    else if (/^FY$/i.test(a) && b && /^20\d{2}$/.test(b)) periods.push(`FY${b}`);
  }

  // Normalize years to FY???? when they look like standalone years and line context suggests FY
  // But keep plain years if that's all we have
  return periods;
}

function isLikelyIncomeStatementContext(line: string) {
  const L = line.toLowerCase();
  return (
    L.includes("income statement") ||
    L.includes("statement of income") ||
    L.includes("profit and loss") ||
    L.includes("p&l") ||
    L.includes("operations") ||
    L.includes("revenues") ||
    L.includes("gross profit") ||
    L.includes("ebitda")
  );
}

function isLikelyBalanceSheetContext(line: string) {
  const L = line.toLowerCase();
  return (
    L.includes("balance sheet") ||
    L.includes("statement of financial position") ||
    L.includes("assets") ||
    L.includes("liabilities") ||
    L.includes("equity")
  );
}

function chooseTableName(ctx: "IS" | "BS") {
  return ctx === "IS" ? "Income Statement (Multi-Period Extracted)" : "Balance Sheet (Multi-Period Extracted)";
}

function labelClassifier(lineLabel: string): "IS" | "BS" | null {
  const L = lineLabel.toLowerCase();

  // Income-ish
  if (
    L.includes("revenue") ||
    L.includes("sales") ||
    L.includes("cogs") ||
    L.includes("cost of goods") ||
    L.includes("gross profit") ||
    L.includes("operating income") ||
    L.includes("operating profit") ||
    L.includes("ebitda") ||
    L.includes("net income") ||
    L.includes("net profit") ||
    L.includes("interest expense") ||
    L.includes("depreciation") ||
    L.includes("amortization")
  ) return "IS";

  // Balance-ish
  if (
    L.includes("cash") ||
    L.includes("accounts receivable") ||
    L.includes("a/r") ||
    L.includes("inventory") ||
    L.includes("total assets") ||
    L.includes("assets") ||
    L.includes("accounts payable") ||
    L.includes("a/p") ||
    L.includes("total liabilities") ||
    L.includes("liabilities") ||
    L.includes("equity") ||
    L.includes("retained earnings") ||
    L.includes("current assets") ||
    L.includes("current liabilities")
  ) return "BS";

  return null;
}

type ParsedRow = {
  label: string;
  values: number[];  // aligned to periods
  rawLine: string;
  ctx: "IS" | "BS";
};

function alignRowValues(values: number[], targetLen: number): number[] {
  // Most statements put values in order corresponding to header.
  // If we have more numbers than periods, keep the last N (labels often include a year or ID earlier).
  if (values.length === targetLen) return values;
  if (values.length > targetLen) return values.slice(values.length - targetLen);
  // If fewer, left-pad with nulls? We'll pad with NaN and later drop row if too sparse.
  const pad = Array(targetLen - values.length).fill(NaN);
  return pad.concat(values);
}

function pickBestHeader(headers: Array<{ idx: number; periods: string[]; line: string }>) {
  // Prefer:
  // - 2+ periods
  // - containing FY or TTM
  // - later in the text than earlier (closer to the table start)
  const scored = headers.map((h) => {
    let score = 0;
    score += h.periods.length * 10;
    if (h.periods.some((p) => p.startsWith("FY"))) score += 5;
    if (h.periods.some((p) => p === "TTM" || p === "LTM")) score += 5;
    // penalize super long lines (often noise)
    if (h.line.length > 120) score -= 2;
    return { h, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.h ?? null;
}

function normalizePeriods(periods: string[]) {
  // Normalize tokens into consistent labels
  return periods.map((p) => {
    const u = p.toUpperCase();
    if (/^20\d{2}$/.test(u)) return `FY${u}`;
    if (/^FY\s?20\d{2}$/.test(u)) return u.replace(" ", "");
    return u;
  });
}

// ---------------------------------------------------------------------------
// DTI (Debt-to-Income) regex extraction
// ---------------------------------------------------------------------------

type DtiExtraction = {
  dtiPercent?: number;
  dtiRatio?: number;
  evidence?: { snippet: string; index: number };
};

function extractDti(text: string): DtiExtraction {
  const t = text ?? "";
  const patterns: RegExp[] = [
    // "Debt-to-Income Ratio: 35%" or "Debt to Income = 35%"
    /\bdebt[\s-]*to[\s-]*income(?:\s+ratio)?\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\s*%/i,
    // "DTI 35%" or "DTI: 35%"
    /\bdti(?:\s+ratio)?\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i,
    // Ratio form: "Debt-to-Income: 0.35"
    /\bdebt[\s-]*to[\s-]*income(?:\s+ratio)?\s*[:=]\s*(0?\.\d+)\b/i,
    // "DTI: 0.35"
    /\bdti(?:\s+ratio)?\s*[:=]\s*(0?\.\d+)\b/i,
  ];

  for (const re of patterns) {
    const m = re.exec(t);
    if (!m) continue;

    const raw = m[1];
    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 40);
    const end = Math.min(t.length, idx + 120);
    const snippet = t.slice(start, end).replace(/\s+/g, " ").trim();

    const val = Number(raw);
    if (!Number.isFinite(val)) continue;

    // Percentage form (val > 1 means it was written as "35%")
    if (val > 1 && val <= 200) {
      return { dtiPercent: val, evidence: { snippet, index: idx } };
    }

    // Ratio form (val <= 1, e.g. 0.35)
    if (val >= 0 && val <= 3) {
      return {
        dtiRatio: val,
        dtiPercent: val * 100,
        evidence: { snippet, index: idx },
      };
    }
  }

  return {};
}

export async function extractFinancialsFromPdf(params: {
  filePath: string;
  docId: string;
  docName: string;
}): Promise<FinancialsExtract> {
  const buf = await fs.readFile(params.filePath);
  const parsed = await parsePdfText(buf);

  const text = parsed.text || "";
  const lines = text
    .split("\n")
    .map((l: string) => norm(l))
    .filter((l: string) => l.length > 0);

  // 1) Find header candidates (lines that look like multi-period column headers)
  const headerCandidates: Array<{ idx: number; periods: string[]; line: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const p = extractPeriodHeaderCandidates(lines[i]);
    // require at least 2 periods for multi-column parsing
    if (p.length >= 2) headerCandidates.push({ idx: i, periods: normalizePeriods(p), line: lines[i] });
  }

  const bestHeader = pickBestHeader(headerCandidates);

  const tables: Table[] = [];
  const evidence: Evidence[] = [];
  const fields: Record<string, any> = {
    extractedTextChars: text.length,
    extractionMode: "multi-period",
  };

  if (!bestHeader) {
    fields.extractionNote =
      "No multi-period header detected (e.g., FY2023/FY2024/TTM). If this is a scanned PDF, OCR is required.";
    return { fields, tables, evidence };
  }

  const periods = bestHeader.periods;
  fields.periodsDetected = periods;

  // 2) Parse rows after header until we hit a stop condition
  const rows: ParsedRow[] = [];
  let ctxHint: "IS" | "BS" | null = null;

  // Look back a few lines for context hints
  for (let k = Math.max(0, bestHeader.idx - 8); k < bestHeader.idx; k++) {
    if (isLikelyIncomeStatementContext(lines[k])) ctxHint = "IS";
    if (isLikelyBalanceSheetContext(lines[k])) ctxHint = "BS";
  }

  // Start scanning after header
  const start = bestHeader.idx + 1;
  const maxScan = Math.min(lines.length, start + 220);

  for (let i = start; i < maxScan; i++) {
    const line = lines[i];

    // Stop conditions (often end of statement section)
    const L = line.toLowerCase();
    if (L.includes("see accompanying notes") || L.includes("continued") || L.includes("page ")) {
      // not always a stop; just skip
    }

    // Candidate row must have at least 2 numeric tokens
    const nums = extractNumericTokens(line);
    if (nums.length < 2) continue;

    const label = stripTrailingNumbers(line);
    if (!label || label.length < 2) continue;

    // Determine statement context
    const inferred = labelClassifier(label);
    const ctx = inferred ?? ctxHint ?? "IS";

    const aligned = alignRowValues(nums.map((x) => x.value), periods.length);

    // Reject rows that are mostly NaN after alignment
    const usable = aligned.filter((x) => !Number.isNaN(x)).length;
    if (usable < 2) continue;

    rows.push({ label, values: aligned, rawLine: line, ctx });
  }

  // 3) Split into IS / BS tables (if both present)
  const isRows = rows.filter((r) => r.ctx === "IS");
  const bsRows = rows.filter((r) => r.ctx === "BS");

  const built: Array<{ name: string; rows: ParsedRow[]; ctx: "IS" | "BS" }> = [];
  if (isRows.length > 0) built.push({ name: chooseTableName("IS"), rows: isRows, ctx: "IS" });
  if (bsRows.length > 0) built.push({ name: chooseTableName("BS"), rows: bsRows, ctx: "BS" });

  // If classifier didn't split well and only IS exists but BS keywords are there, fallback: one table
  if (built.length === 0 && rows.length > 0) {
    built.push({ name: "Financial Statement (Multi-Period Extracted)", rows, ctx: "IS" });
  }

  // 4) Construct tables + evidence
  for (const t of built) {
    const columns = ["Line Item", ...periods];
    const outRows = t.rows
      .slice(0, 80) // cap for sanity
      .map((r) => [r.label, ...r.values.map((v) => (Number.isNaN(v) ? "" : v))]);

    tables.push({
      name: t.name,
      columns,
      rows: outRows,
    });

    t.rows.slice(0, 80).forEach((r, idx) => {
      evidence.push({
        id: `EV_${params.docId}_${t.ctx}_${idx}`,
        docId: params.docId,
        docName: params.docName,
        docType: "FINANCIALS",
        table: t.name,
        field: r.label,
        value: r.values.find((v) => !Number.isNaN(v)) ?? undefined,
        excerpt: r.rawLine,
        confidence: 0.78,
      });
    });
  }

  // 5) Create "key fields" from common line items for the newest period (last column)
  const latestIdx = periods.length - 1;

  const findLine = (needle: RegExp) => {
    const all = rows;
    const hit = all.find((r) => needle.test(r.label.toLowerCase()));
    if (!hit) return null;
    const val = hit.values[latestIdx];
    if (Number.isNaN(val)) return null;
    return { label: hit.label, value: val, raw: hit.rawLine };
  };

  const revenue = findLine(/revenue|sales/);
  const ebitda = findLine(/ebitda/);
  const netIncome = findLine(/net income|net profit/);
  const totalAssets = findLine(/total assets/);
  const totalLiab = findLine(/total liabilities/);
  const equity = findLine(/total equity|equity/);

  if (revenue) {
    fields.Revenue = revenue.value;
    evidence.push({
      id: `EV_${params.docId}_KEY_Revenue`,
      docId: params.docId,
      docName: params.docName,
      docType: "FINANCIALS",
      field: "Revenue(latest)",
      value: revenue.value,
      excerpt: revenue.raw,
      confidence: 0.85,
    });
  }
  if (ebitda) {
    fields.EBITDA = ebitda.value;
    evidence.push({
      id: `EV_${params.docId}_KEY_EBITDA`,
      docId: params.docId,
      docName: params.docName,
      docType: "FINANCIALS",
      field: "EBITDA(latest)",
      value: ebitda.value,
      excerpt: ebitda.raw,
      confidence: 0.85,
    });
  }
  if (netIncome) {
    fields.NetIncome = netIncome.value;
    evidence.push({
      id: `EV_${params.docId}_KEY_NetIncome`,
      docId: params.docId,
      docName: params.docName,
      docType: "FINANCIALS",
      field: "NetIncome(latest)",
      value: netIncome.value,
      excerpt: netIncome.raw,
      confidence: 0.82,
    });
  }

  // Balance rollups (latest)
  if (totalAssets) fields.TotalAssets = totalAssets.value;
  if (totalLiab) fields.TotalLiabilities = totalLiab.value;
  if (equity) fields.TotalEquity = equity.value;

  // 6) Provide a normalized "financialPeriods" array for future spread engine
  fields.financialPeriods = periods.map((p, pIdx) => {
    const periodObj: Record<string, any> = { label: p, incomeStatement: {}, balanceSheet: {} };

    // Map top IS rows into incomeStatement
    isRows.slice(0, 120).forEach((r) => {
      const v = r.values[pIdx];
      if (!Number.isNaN(v)) periodObj.incomeStatement[r.label] = v;
    });

    // Map top BS rows into balanceSheet
    bsRows.slice(0, 120).forEach((r) => {
      const v = r.values[pIdx];
      if (!Number.isNaN(v)) periodObj.balanceSheet[r.label] = v;
    });

    return periodObj;
  });

  // 7) Extract DTI (Debt-to-Income) ratio if stated in the document
  const dti = extractDti(text);
  if (dti.dtiPercent != null) {
    fields.dtiPercent = dti.dtiPercent;
    if (dti.dtiRatio != null) fields.dtiRatio = dti.dtiRatio;
    if (dti.evidence) {
      evidence.push({
        id: `EV_${params.docId}_KEY_DTI`,
        docId: params.docId,
        docName: params.docName,
        docType: "FINANCIALS",
        field: "DTI(percent)",
        value: dti.dtiPercent,
        excerpt: dti.evidence.snippet,
        confidence: 0.9,
      });
    }
  }

  return { fields, tables, evidence };
}
