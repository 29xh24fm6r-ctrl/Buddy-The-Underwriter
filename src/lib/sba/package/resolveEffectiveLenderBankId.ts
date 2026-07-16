import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every dispatched SBA form that prints a "Lender Name" field (4506-C,
 * 155, 148/148L, 601, 159) resolves it by looking up `banks.name` for
 * whatever `bankId` its caller passes in. For the Underwriter tenant that
 * `bankId` is `deals.bank_id`, which really is the originating lender — no
 * issue. For a Brokerage deal, `deals.bank_id` is the singleton
 * `BUDDY_BROKERAGE` tenant row, not a lender at all; once the borrower has
 * picked a winning lender (`marketplace_picks`), forms addressed to "the
 * lender" should print that lender's name, not the brokerage's.
 *
 * `src/lib/brokerage/compliancePackage.ts`'s Form 159 flow already solves
 * this exact problem for its own call path (`lbid` resolution there) —
 * this is that same lookup, extracted so `generatePdfForFillRun.ts` can
 * apply it once, upstream of every dispatched form, instead of Form 159
 * being the only one that gets it right.
 */
export async function resolveEffectiveLenderBankId(
  dealId: string,
  dealBankId: string,
  sb: SupabaseClient,
): Promise<string> {
  const { data: pick } = await sb
    .from("marketplace_picks")
    .select("picked_lender_bank_id")
    .eq("deal_id", dealId)
    .eq("status", "picked")
    .limit(1)
    .maybeSingle();

  const pickedLenderBankId = (pick as { picked_lender_bank_id?: string | null } | null)?.picked_lender_bank_id;
  return pickedLenderBankId ?? dealBankId;
}
