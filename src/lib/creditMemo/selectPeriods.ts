import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type SelectedPeriod = {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
};

export type PeriodSelection = {
  fiscal: SelectedPeriod[];  // up to 3, most recent first
  interim: SelectedPeriod | null;
};

/**
 * Discover available periods from deal_financial_facts.
 *
 * Rules:
 * - Choose last 3 fiscal years (by fact_period_end)
 * - Plus most recent interim if it doesn't coincide with a FY end
 * - Never hardcode years
 */
export async function selectPeriods(args: {
  dealId: string;
  bankId: string;
}): Promise<PeriodSelection> {
  const sb = supabaseAdmin();

  // Get distinct period ranges from facts
  const { data: periodRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_period_start, fact_period_end")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .not("fact_period_end", "is", null)
    .order("fact_period_end", { ascending: false })
    .limit(200);

  if (!periodRows || periodRows.length === 0) {
    return { fiscal: [], interim: null };
  }

  // Deduplicate period ranges
  const seen = new Set<string>();
  const periods: Array<{ start: string | null; end: string }> = [];

  for (const row of periodRows) {
    const end = toIsoDate(row.fact_period_end);
    if (!end) continue;
    const start = toIsoDate(row.fact_period_start);
    const key = `${start ?? ""}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    periods.push({ start, end });
  }

  // Sort by end date descending
  periods.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));

  // Identify fiscal year periods (roughly 12-month spans, or ending on common FY boundaries)
  const fiscal: SelectedPeriod[] = [];
  let interim: SelectedPeriod | null = null;

  for (const p of periods) {
    if (fiscal.length >= 3) break;

    const spanMonths = p.start ? monthsBetween(p.start, p.end) : null;

    // A fiscal year: 10-14 month span, or ending on Dec 31 / common FY ends
    const isFY = spanMonths !== null && spanMonths >= 10 && spanMonths <= 14;
    const isYearEnd = p.end.endsWith("-12-31") || p.end.endsWith("-09-30") || p.end.endsWith("-06-30") || p.end.endsWith("-03-31");

    if (isFY || isYearEnd) {
      fiscal.push({ start: p.start ?? yearStart(p.end), end: p.end });
    } else if (!interim && spanMonths !== null && spanMonths < 10) {
      // Interim period (shorter than FY)
      interim = { start: p.start ?? yearStart(p.end), end: p.end };
    }
  }

  // If no fiscal periods found, treat up to 3 most recent periods as fiscal
  if (fiscal.length === 0) {
    for (const p of periods.slice(0, 3)) {
      fiscal.push({ start: p.start ?? yearStart(p.end), end: p.end });
    }
  }

  return { fiscal, interim };
}

function toIsoDate(s: unknown): string | null {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm);
}

function yearStart(endDate: string): string {
  // Derive a reasonable start from the end date (1 year prior)
  const [y, m, d] = endDate.split("-").map(Number);
  const startYear = y - 1;
  const startMonth = String(m).padStart(2, "0");
  const startDay = String(d).padStart(2, "0");
  return `${startYear}-${startMonth}-${startDay}`;
}
