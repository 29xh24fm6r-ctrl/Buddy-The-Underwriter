/**
 * AR Aging Parser — pure module.
 *
 * Consumed by arCollateralProcessor (server-only) and CI tests.
 * Lives outside the server-only boundary so that node:test runners can
 * import the parser without tripping the Next.js server-only marker.
 */

export type ArAgingCustomerRow = {
  customer: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
  total: number;
};

/**
 * Extract up to `max` header rows from tables_json for diagnostic events.
 * Returns the first row of each table (best-effort), capped per cell so a
 * pathological extract can't blow the 50KB ledger payload cap.
 */
export function sampleHeaders(tablesJson: unknown, max = 3): string[][] {
  if (!Array.isArray(tablesJson)) return [];
  const out: string[][] = [];
  for (const table of tablesJson) {
    if (out.length >= max) break;
    const rawRows = (table as any)?.rows ?? (table as any)?.cells;
    if (!Array.isArray(rawRows) || rawRows.length === 0) continue;
    const header = rawRows[0];
    if (!Array.isArray(header)) continue;
    out.push(header.map((c: unknown) => String(c ?? "").slice(0, 80)));
  }
  return out;
}

export function parseARAgingTable(tablesJson: unknown): ArAgingCustomerRow[] {
  if (!Array.isArray(tablesJson)) return [];

  for (const table of tablesJson) {
    const rawRows = (table as any)?.rows ?? (table as any)?.cells;
    if (!Array.isArray(rawRows) || rawRows.length < 2) continue;

    const header = rawRows[0];
    if (!Array.isArray(header)) continue;

    const idx = mapHeaderColumns(header.map((c: unknown) => String(c ?? "")));
    if (idx.customer === -1) continue;

    const out: ArAgingCustomerRow[] = [];
    for (let i = 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (!Array.isArray(r)) continue;

      const customer = String(r[idx.customer] ?? "").trim();
      if (!customer) continue;
      // Skip total/footer rows so they don't double-count.
      if (/\b(grand\s*total|total\b)/i.test(customer)) continue;

      const row: ArAgingCustomerRow = {
        customer,
        current: pickAmt(r, idx.current),
        d30: pickAmt(r, idx.d30),
        d60: pickAmt(r, idx.d60),
        d90: pickAmt(r, idx.d90),
        d120: pickAmt(r, idx.d120),
        total: pickAmt(r, idx.total),
      };
      if (row.total === 0) {
        row.total = row.current + row.d30 + row.d60 + row.d90 + row.d120;
      }
      if (row.total !== 0) out.push(row);
    }
    if (out.length > 0) return out;
  }

  return [];
}

function mapHeaderColumns(header: string[]) {
  const idx = {
    customer: -1,
    current: -1,
    d30: -1,
    d60: -1,
    d90: -1,
    d120: -1,
    total: -1,
  };
  for (let i = 0; i < header.length; i++) {
    const s = header[i].toLowerCase().trim();
    if (idx.customer === -1 && /(customer|client|account\s*name|debtor)/.test(s)) {
      idx.customer = i;
    } else if (idx.current === -1 && /(current|not\s*due|0\s*-\s*30)/.test(s)) {
      idx.current = i;
    } else if (idx.d30 === -1 && /(1\s*-\s*30|^30(\s*days?)?$)/.test(s)) {
      idx.d30 = i;
    } else if (idx.d60 === -1 && /(31\s*-\s*60|^60(\s*days?)?$)/.test(s)) {
      idx.d60 = i;
    } else if (idx.d90 === -1 && /(61\s*-\s*90|^90(\s*days?)?$)/.test(s)) {
      idx.d90 = i;
    } else if (
      idx.d120 === -1 &&
      /(over\s*90|>\s*90|91\+|120\+|over\s*120|>\s*120|^120(\s*days?)?$)/.test(s)
    ) {
      idx.d120 = i;
    } else if (idx.total === -1 && /^total\b|total\s*amount|total\s*due|balance/.test(s)) {
      idx.total = i;
    }
  }
  return idx;
}

function pickAmt(row: unknown[], i: number): number {
  if (i < 0) return 0;
  return parseAmount(row[i]);
}

function parseAmount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  const s = v.trim();
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, "");
  const negParens = /^\((.+)\)$/.exec(cleaned);
  const num = Number(negParens ? `-${negParens[1]}` : cleaned);
  return Number.isFinite(num) ? num : 0;
}
