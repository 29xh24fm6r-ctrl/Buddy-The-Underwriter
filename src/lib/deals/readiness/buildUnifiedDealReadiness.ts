// Server-only assembler for UnifiedDealReadiness.
//
// Loads lifecycle state, memo input package readiness, and credit memo
// submission status, then runs the pure unifyDealReadiness combiner.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { deriveLifecycleState } from "@/buddy/lifecycle/deriveLifecycleState";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import {
  unifyDealReadiness,
  type CreditMemoSubmissionStatus,
} from "./unifyDealReadiness";
import type { UnifiedDealReadiness } from "./types";

export type BuildUnifiedDealReadinessArgs = {
  dealId: string;
  // When true, the memo input package assembler runs reconciliation (writes
  // to deal_fact_conflicts). The submission pipeline calls with true; the
  // GET /readiness endpoint also passes true so the rail reflects current
  // state. Pass false from background workers that just want to read.
  runReconciliation?: boolean;
};

export type BuildUnifiedDealReadinessResult =
  | { ok: true; readiness: UnifiedDealReadiness; bankId: string }
  | {
      ok: false;
      reason: "tenant_mismatch" | "lifecycle_failed" | "memo_input_failed";
      error?: string;
    };

export async function buildUnifiedDealReadiness(
  args: BuildUnifiedDealReadinessArgs,
): Promise<BuildUnifiedDealReadinessResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;

  const lifecycle = await deriveLifecycleState(args.dealId);

  const inputResult = await buildMemoInputPackage({
    dealId: args.dealId,
    runReconciliation: args.runReconciliation ?? true,
  });
  const memoInputReadiness =
    inputResult.ok ? inputResult.package.readiness : null;

  const creditMemo = await loadCreditMemoSubmissionStatus(args.dealId);

  const readiness = unifyDealReadiness({
    dealId: args.dealId,
    lifecycle,
    memoInput: memoInputReadiness,
    creditMemo,
  });

  return { ok: true, readiness, bankId };
}

async function loadCreditMemoSubmissionStatus(
  dealId: string,
): Promise<CreditMemoSubmissionStatus> {
  const sb = supabaseAdmin();
  try {
    const { data } = await (sb as any)
      .from("credit_memo_snapshots")
      .select("id, status")
      .eq("deal_id", dealId)
      .in("status", [
        "banker_submitted",
        "underwriter_review",
        "returned",
        "finalized",
      ])
      .order("memo_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      return { submitted: false, snapshotId: null, finalized: false };
    }
    const status = String((data as any).status ?? "");
    return {
      submitted: true,
      snapshotId: (data as any).id ?? null,
      finalized: status === "finalized",
    };
  } catch {
    return { submitted: false, snapshotId: null, finalized: false };
  }
}
