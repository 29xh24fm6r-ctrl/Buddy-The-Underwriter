import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { validateResolutionInput, type ResolutionInput, type GapType, type ResolvedStatus } from "./validateResolutionInput";

type ResolveArgs = ResolutionInput & {
  dealId: string; bankId: string; actorUserId: string; actorRole: string;
};
export type ResolveResult = {
  ok: true;
  resolution: { gapId: string; factId: string | null; resolvedStatus: ResolvedStatus;
    action: string; resolvedValue: number | null; rationale: string | null; resolvedAt: string };
} | { ok: false; error: string; errors?: Array<{ field: string; message: string }> };

/** The only review writer. The RPC locks and revalidates scope, then commits
 * the canonical fact, gap, conflict and review audit in one transaction. */
export async function resolveFinancialReviewItem(args: ResolveArgs): Promise<ResolveResult> {
  try {
    const sb = supabaseAdmin();
    const { data: gap, error } = await sb.from("deal_gap_queue")
      .select("gap_type").eq("id", args.gapId).eq("deal_id", args.dealId).eq("bank_id", args.bankId).maybeSingle();
    if (error) return { ok: false, error: "review_read_failed" };
    if (!gap) return { ok: false, error: "gap_not_found" };
    const errors = validateResolutionInput(args, gap.gap_type as GapType);
    if (errors.length) return { ok: false, error: "validation_failed", errors };
    const result = await sb.rpc("resolve_canonical_financial_review", {
      p_deal_id: args.dealId, p_bank_id: args.bankId, p_gap_id: args.gapId,
      p_actor_user_id: args.actorUserId, p_actor_role: args.actorRole,
      p_intent: { action: args.action, factId: args.factId ?? null,
        conflictId: args.conflictId ?? null, resolvedValue: args.resolvedValue ?? null,
        resolvedPeriodStart: args.resolvedPeriodStart ?? null, resolvedPeriodEnd: args.resolvedPeriodEnd ?? null,
        rationale: args.rationale ?? null },
    });
    if (result.error) return { ok: false, error: result.error.message };
    if (!result.data?.ok || !result.data?.resolution?.resolvedAt) return { ok: false, error: "review_commit_failed" };
    return result.data as ResolveResult;
  } catch {
    return { ok: false, error: "review_commit_failed" };
  }
}
