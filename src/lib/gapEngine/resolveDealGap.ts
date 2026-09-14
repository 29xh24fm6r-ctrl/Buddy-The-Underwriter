import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveFinancialReviewItem } from "@/lib/financialReview/resolveFinancialReviewItem";
import type { ResolutionAction } from "@/lib/financialReview/validateResolutionInput";

export type GapResolution = {
  action: "confirm" | "reject" | "resolve_conflict" | "provide_value";
  dealId: string; bankId: string; userId: string;
  gapId?: string; factId?: string; conflictId?: string; winningFactId?: string;
  factType?: string; factKey?: string; value?: number | string;
  rationale?: string; resolvedPeriodStart?: string; resolvedPeriodEnd?: string;
};

/** Compatibility adapter; all writes belong to the financial-review transaction. */
export async function resolveDealGap(input: GapResolution): Promise<{ ok: true } | { ok: false; error: string }> {
  const actions: Record<GapResolution["action"], ResolutionAction> = {
    confirm: "confirm_value", reject: "reject_value", resolve_conflict: "choose_source_value", provide_value: "provide_value",
  };
  const action = actions[input.action];
  if (!action || !input.dealId || !input.bankId || !input.userId) return { ok: false, error: "invalid_review_input" };
  try {
    let gapId = input.gapId;
    if (!gapId) {
      let query = supabaseAdmin().from("deal_gap_queue").select("id")
        .eq("deal_id", input.dealId).eq("bank_id", input.bankId).eq("status", "open");
      if (input.action === "resolve_conflict" && input.conflictId) query = query.eq("conflict_id", input.conflictId);
      else if (input.factId) query = query.eq("fact_id", input.factId);
      else return { ok: false, error: "gap_required" };
      const { data, error } = await query.maybeSingle();
      if (error || !data) return { ok: false, error: "gap_not_found" };
      gapId = data.id;
    }
    const result = await resolveFinancialReviewItem({
      gapId: gapId!, action, dealId: input.dealId, bankId: input.bankId,
      actorUserId: input.userId, actorRole: "banker",
      factId: input.winningFactId ?? input.factId, conflictId: input.conflictId,
      resolvedValue: typeof input.value === "number" ? input.value : null,
      resolvedPeriodStart: input.resolvedPeriodStart, resolvedPeriodEnd: input.resolvedPeriodEnd,
      rationale: input.rationale,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.errors?.[0]?.message ?? result.error };
  } catch {
    return { ok: false, error: "review_commit_failed" };
  }
}
