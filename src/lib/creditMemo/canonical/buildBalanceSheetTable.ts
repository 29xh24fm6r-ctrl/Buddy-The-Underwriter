import "server-only";

/**
 * buildBalanceSheetTable
 *
 * Reads balance sheet facts directly from deal_financial_facts using SL_ prefixed keys.
 * This is the permanent extraction-driven approach — fully independent of the deal_spreads
 * BALANCE_SHEET row. As long as the document extractor writes SL_ facts (which it always
 * does for Schedule L / balance sheet documents), the credit memo will always have
 * multi-period balance sheet data.
 *
 * SL_ key provenance:
 *   - fact_type = BALANCE_SHEET  → from YTD/interim balance sheet statements
 *   - fact_type = TAX_RETURN     → from Schedule L (Form 1120S / 1065 tax returns)
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BalanceSheetRow } from "@/lib/creditMemo/canonical/types";

// ── SL_ key → BalanceSheetRow field mapping ──────────────────────────────────
// Every SL_ key the extractor writes must be represented here.
// Unknown SL_ keys are silently skipped — safe to add new keys without breaking callers.
const SL_ALIAS: Partial<Record<string, keyof BalanceSheetRow>> = {
  SL_CASH:                    "cash_and_equivalents",
  SL_ACCOUNTS_RECEIVABLE:     "accounts_receivable",
  SL_INVENTORY:               "inventory",
  SL_TOTAL_CURRENT_ASSETS:    "total_current_assets",
  SL_PPE_GROSS:               "ppe_gross",
  SL_ACCUMULATED_DEPRECIATION:"accumulated_depreciation",
  SL_OTHER_ASSETS:            "other_assets",
  SL_TOTAL_ASSETS:            "total_assets",
  SL_ACCOUNTS_PAYABLE:        "accounts_payable",
  SL_TOTAL_CURRENT_LIABILITIES:"total_current_liabilities",
  SL_MORTGAGES_NOTES_BONDS:   "mortgages_notes_bonds",
  SL_OTHER_LIABILITIES:       "other_long_term_liabilities",
  SL_TOTAL_LIABILITIES:       "total_liabilities",
  SL_RETAINED_EARNINGS:       "retained_earnings",
  SL_TOTAL_EQUITY:            "total_equity",
  // Additional aliases the extractor may write
  SL_SHAREHOLDERS_EQUITY:     "total_equity",
  SL_MEMBERS_EQUITY:          "total_equity",
  SL_PARTNERS_CAPITAL:        "total_equity",
  SL_NOTES_PAYABLE:           "mortgages_notes_bonds",
  SL_LONG_TERM_DEBT:          "mortgages_notes_bonds",
  SL_OTHER_CURRENT_ASSETS:    "other_current_assets",
  SL_OTHER_CURRENT_LIABILITIES:"other_current_liabilities",
};

function emptyRow(periodEnd: string): BalanceSheetRow {
  return {
    period_end: periodEnd.slice(0, 10),
    cash_and_equivalents: null,
    accounts_receivable: null,
    inventory: null,
    other_current_assets: null,
    total_current_assets: null,
    ppe_gross: null,
    accumulated_depreciation: null,
    ppe_net: null,
    other_assets: null,
    total_assets: null,
    accounts_payable: null,
    other_current_liabilities: null,
    total_current_liabilities: null,
    mortgages_notes_bonds: null,
    other_long_term_liabilities: null,
    total_liabilities: null,
    retained_earnings: null,
    total_equity: null,
    liabilities_plus_equity: null,
  };
}

export async function buildBalanceSheetTable(args: {
  dealId: string;
  bankId: string;
}): Promise<BalanceSheetRow[]> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_period_end")
      .eq("deal_id", args.dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .like("fact_key", "SL_%")
      .not("fact_value_num", "is", null)
      .order("fact_period_end", { ascending: false })
      .limit(120);

    if (error || !data?.length) return [];

    // Group by period_end — first-write-wins (BALANCE_SHEET type facts come first
    // since the query is ordered desc by period, and within a period the more
    // authoritative BALANCE_SHEET type will typically precede TAX_RETURN).
    const byPeriod: Record<string, Record<string, number>> = {};
    for (const f of (data as Array<{ fact_key: string; fact_value_num: string | number; fact_period_end: string }>)) {
      const period = f.fact_period_end;
      if (!byPeriod[period]) byPeriod[period] = {};
      const field = SL_ALIAS[f.fact_key];
      if (field && !(field in byPeriod[period])) {
        byPeriod[period][field] = Number(f.fact_value_num);
      }
    }

    return Object.entries(byPeriod)
      .slice(0, 4) // max 4 periods
      .map(([period, facts]) => {
        const row = emptyRow(period);

        // Map all available facts onto the row
        for (const [field, value] of Object.entries(facts)) {
          (row as any)[field] = value;
        }

        // Derive PPE net if possible
        if (row.ppe_net === null && row.ppe_gross !== null && row.accumulated_depreciation !== null) {
          row.ppe_net = row.ppe_gross - row.accumulated_depreciation;
        }

        // Derive total_assets from components when not directly available
        if (row.total_assets === null && row.ppe_net !== null && row.cash_and_equivalents !== null) {
          row.total_assets =
            (row.cash_and_equivalents ?? 0) +
            (row.accounts_receivable ?? 0) +
            (row.inventory ?? 0) +
            (row.other_current_assets ?? 0) +
            row.ppe_net +
            (row.other_assets ?? 0);
        }

        // Derive liabilities_plus_equity
        if (row.total_liabilities !== null && row.total_equity !== null) {
          row.liabilities_plus_equity = row.total_liabilities + row.total_equity;
        } else if (row.total_assets !== null) {
          // Fallback: L+E = Assets (balance sheet identity)
          row.liabilities_plus_equity = row.total_assets;
        }

        return row;
      });
  } catch {
    // Non-fatal — credit memo generation must never fail due to BS table error
    return [];
  }
}
