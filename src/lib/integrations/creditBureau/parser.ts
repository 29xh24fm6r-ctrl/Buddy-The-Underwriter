/**
 * SPEC S4 B-1 — pure credit-report parser. No "server-only", no DB access.
 *
 * Documented assumption (PIV-3 gap: no live vendor account, so no confirmed
 * wire format from any bureau vendor): `plaid_check` nests the report body
 * under a top-level `report` key (matching how Plaid nests most product
 * responses); other vendors are assumed flat. Both shapes normalize to the
 * same `RawTradeline`/`RawCreditReportJson` field names below. Whoever
 * wires up the real vendor should confirm this against actual API docs —
 * flagged in the Drift Log, not a blocker for building the parsing logic
 * (missing fields, malformed dates, delinquency detection) that this module
 * actually needs to get right regardless of exact vendor field names.
 */

export type RawTradeline = {
  account_type?: string | null;
  creditor_name?: string | null;
  account_number_masked?: string | null;
  open_date?: string | null;
  closed_date?: string | null;
  high_credit?: number | null;
  current_balance?: number | null;
  monthly_payment?: number | null;
  payment_history_24mo?: string | null;
  status?: string | null; // 'open' | 'closed' | 'charge_off' | 'collection'
};

export type RawCreditReportJson = {
  tradelines?: RawTradeline[] | null;
  fico_score?: number | null;
  public_records?: unknown[] | null;
  inquiries_24mo?: unknown[] | null;
};

export type ParsedTradeline = {
  account_type: string | null;
  creditor_name: string | null;
  account_number_masked: string | null;
  open_date: string | null;
  closed_date: string | null;
  high_credit: number | null;
  current_balance: number | null;
  monthly_payment: number | null;
  payment_history_24mo: string | null;
  is_delinquent: boolean;
  is_charged_off: boolean;
  is_in_collection: boolean;
  raw_json: RawTradeline;
};

export type ParsedCreditReport = {
  tradelines: ParsedTradeline[];
  summary: {
    fico_score: number | null;
    delinquencies_count: number;
    public_records_count: number;
    inquiries_24mo_count: number;
  };
};

const DELINQUENCY_CODE_PATTERN = /[2-9]/;

function toNumOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : v;
}

function unwrap(rawJson: unknown, vendor: string): RawCreditReportJson {
  if (!rawJson || typeof rawJson !== "object") return {};
  const obj = rawJson as Record<string, unknown>;
  if (vendor === "plaid_check" && obj.report && typeof obj.report === "object") {
    return obj.report as RawCreditReportJson;
  }
  return obj as RawCreditReportJson;
}

function parseTradeline(raw: RawTradeline): ParsedTradeline {
  const paymentHistory = typeof raw.payment_history_24mo === "string" ? raw.payment_history_24mo : null;
  const status = typeof raw.status === "string" ? raw.status : null;

  return {
    account_type: typeof raw.account_type === "string" ? raw.account_type : null,
    creditor_name: typeof raw.creditor_name === "string" ? raw.creditor_name : null,
    account_number_masked: typeof raw.account_number_masked === "string" ? raw.account_number_masked : null,
    open_date: toDateOrNull(raw.open_date),
    closed_date: toDateOrNull(raw.closed_date),
    high_credit: toNumOrNull(raw.high_credit),
    current_balance: toNumOrNull(raw.current_balance),
    monthly_payment: toNumOrNull(raw.monthly_payment),
    payment_history_24mo: paymentHistory,
    is_charged_off: status === "charge_off",
    is_in_collection: status === "collection",
    is_delinquent: status === "charge_off" || status === "collection" || (paymentHistory != null && DELINQUENCY_CODE_PATTERN.test(paymentHistory)),
    raw_json: raw,
  };
}

export function parseCreditReport(rawJson: unknown, vendor: string): ParsedCreditReport {
  const report = unwrap(rawJson, vendor);
  const rawTradelines = Array.isArray(report.tradelines) ? report.tradelines : [];
  const tradelines = rawTradelines.map(parseTradeline);

  return {
    tradelines,
    summary: {
      fico_score: toNumOrNull(report.fico_score),
      delinquencies_count: tradelines.filter((t) => t.is_delinquent).length,
      public_records_count: Array.isArray(report.public_records) ? report.public_records.length : 0,
      inquiries_24mo_count: Array.isArray(report.inquiries_24mo) ? report.inquiries_24mo.length : 0,
    },
  };
}
