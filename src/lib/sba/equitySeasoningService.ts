import { verifyEquitySeasoning, type VerifyEquitySeasoningResult } from "@/lib/sba/equitySeasoning";

/**
 * SPEC S4 E-2 — DB-aware wrapper around the pure verifyEquitySeasoning().
 * Free of "server-only" for testability (same pattern as the rest of this
 * arc's service modules). Wired into plaid/sync.ts's existing post-sync
 * fire-and-forget hook (SPEC S2 G-1) so seasoning re-verifies automatically
 * whenever new transaction history lands — no separate API route needed.
 */

export type EquitySeasoningSupabaseClient = { from: (table: string) => any };

export type VerifyEquitySeasoningForDealResult =
  | ({ ok: true } & VerifyEquitySeasoningResult)
  | { ok: false; reason: "NO_EQUITY_AMOUNT" | "PLAID_HISTORY_INSUFFICIENT" };

export async function verifyEquitySeasoningForDeal(
  dealId: string,
  bankId: string,
  sb: EquitySeasoningSupabaseClient,
  requiredDays = 90,
): Promise<VerifyEquitySeasoningForDealResult> {
  const { data: loanRequest } = await sb
    .from("deal_loan_requests")
    .select("equity_injection_amount, injection_amount")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const equityAmount =
    (loanRequest as { equity_injection_amount?: number } | null)?.equity_injection_amount ??
    (loanRequest as { injection_amount?: number } | null)?.injection_amount ??
    null;

  if (equityAmount == null || equityAmount <= 0) {
    return { ok: false, reason: "NO_EQUITY_AMOUNT" };
  }

  const { data: accounts } = await sb
    .from("borrower_bank_accounts")
    .select("id, current_balance")
    .eq("deal_id", dealId);

  const accountRows = (accounts ?? []) as Array<{ id: string; current_balance: number | null }>;
  if (accountRows.length === 0) {
    return { ok: false, reason: "PLAID_HISTORY_INSUFFICIENT" };
  }

  const currentBalance = accountRows.reduce((sum, a) => sum + (a.current_balance ?? 0), 0);

  const { data: transactions } = await sb
    .from("borrower_bank_transactions")
    .select("posted_date, amount, merchant_name, description")
    .eq("deal_id", dealId);

  const result = verifyEquitySeasoning({
    equityAmount,
    currentBalance,
    transactions: (transactions ?? []) as Array<{ posted_date: string; amount: number; merchant_name?: string | null; description?: string | null }>,
    requiredDays,
  });

  if (result.gaps.length > 0) {
    await sb.from("deal_gap_queue").insert(
      result.gaps.map((g) => ({
        deal_id: dealId,
        bank_id: bankId,
        gap_type: g.type,
        fact_type: "equity_seasoning",
        fact_key: `equity_seasoning.${g.type}`,
        owner_entity_id: null,
        description: g.message,
        resolution_prompt: "Review the equity injection seasoning finding and provide any additional documentation needed.",
        priority: g.type === "seasoning_window_incomplete" ? 3 : 2,
        status: "open",
      })),
    );
  }

  await sb.from("deal_events").insert({
    deal_id: dealId,
    kind: "equity_seasoning.verified",
    payload: { seasoned: result.seasoned, gap_count: result.gaps.length, large_deposit_count: result.large_deposits.length },
  });

  return { ok: true, ...result };
}
