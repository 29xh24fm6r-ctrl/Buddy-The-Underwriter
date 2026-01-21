import type { SupabaseClient } from "@supabase/supabase-js";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";
import {
  logUnderwriteVerifyLedger,
  type UnderwriteVerifyDetails,
  type UnderwriteVerifySource,
} from "@/lib/deals/underwriteVerifyLedger";

export type VerifyUnderwriteRecommendedNextAction =
  | "complete_intake"
  | "checklist_incomplete"
  | "pricing_required"
  | "deal_not_found";

export type VerifyUnderwriteSuccess = {
  ok: true;
  dealId: string;
  redirectTo: `/deals/${string}/underwrite`;
  ledgerEventsWritten: string[];
};

export type VerifyUnderwriteBlocked = {
  ok: false;
  dealId: string;
  auth: true;
  recommendedNextAction: VerifyUnderwriteRecommendedNextAction;
  diagnostics: {
    dealId?: string;
    lookedIn?: string[];
    foundIn?: {
      supabaseDeals?: boolean;
    };
    bankId?: string | null;
    dbError?: string | null;
    missing?: string[];
    lifecycleStage?: string | null;
  };
  ledgerEventsWritten: string[];
};

export type VerifyUnderwriteResult = VerifyUnderwriteSuccess | VerifyUnderwriteBlocked;

export type VerifyUnderwriteDeps = {
  sb: SupabaseClient;
  logLedgerEvent: typeof logLedgerEvent;
  getLatestLockedQuoteId: typeof getLatestLockedQuoteId;
};

export type VerifyUnderwriteParams = {
  dealId: string;
  actor?: "banker" | "system";
  logAttempt?: boolean;
  verifySource?: UnderwriteVerifySource;
  verifyDetails?: Partial<UnderwriteVerifyDetails> | null;
  deps: VerifyUnderwriteDeps;
};

const INTAKE_COMPLETE_STAGES = new Set(["collecting", "underwriting", "ready"]);

async function hasCreditSnapshot(sb: SupabaseClient, dealId: string) {
  const { count } = await sb
    .from("financial_snapshot_decisions")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);
  return Boolean(count && count > 0);
}

export async function verifyUnderwriteCore(
  params: VerifyUnderwriteParams,
): Promise<VerifyUnderwriteResult> {
  const {
    dealId,
    actor = "banker",
    logAttempt = true,
    verifySource = "runtime",
    verifyDetails,
    deps,
  } = params;
  const { sb, logLedgerEvent: ledger, getLatestLockedQuoteId: latestQuote } = deps;

  const ledgerEventsWritten: string[] = [];

  const logAttemptEvent = async (
    bankId: string | null,
    allowed: boolean,
    reason: VerifyUnderwriteRecommendedNextAction | null,
    diagnostics?: Record<string, unknown> | null,
  ) => {
    if (!logAttempt || !bankId) return;
    await logUnderwriteVerifyLedger({
      dealId,
      bankId,
      status: allowed ? "pass" : "fail",
      source: verifySource,
      details: {
        url: verifyDetails?.url ?? "internal://verify-underwrite",
        auth: verifyDetails?.auth ?? true,
        html: verifyDetails?.html ?? false,
        metaFallback: verifyDetails?.metaFallback ?? false,
        httpStatus: verifyDetails?.httpStatus,
        error: verifyDetails?.error,
        redacted: verifyDetails?.redacted ?? true,
      },
      recommendedNextAction: reason,
      diagnostics: diagnostics ?? null,
      logLedgerEvent: ledger,
    });
    ledgerEventsWritten.push("deal.underwrite.verify");
  };

  const { data: deal, error } = await sb
    .from("deals")
    .select("id, bank_id, display_name, nickname, borrower_id, lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  const lookupDiagnostics = {
    dealId,
    lookedIn: ["supabase.deals"],
    foundIn: {
      supabaseDeals: Boolean(deal && !error),
    },
    bankId: deal?.bank_id ? String(deal.bank_id) : null,
    lifecycleStage: deal?.lifecycle_stage ? String(deal.lifecycle_stage) : null,
    dbError: error?.message ?? null,
  };

  if (error || !deal) {
    await logAttemptEvent(null, false, "deal_not_found", lookupDiagnostics);
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "deal_not_found",
      diagnostics: lookupDiagnostics,
      ledgerEventsWritten,
    };
  }

  const bankId = lookupDiagnostics.bankId;
  const missing: string[] = [];

  const hasDisplayName = Boolean(
    (deal as any)?.display_name && String((deal as any).display_name).trim(),
  );
  const hasNickname = Boolean(
    (deal as any)?.nickname && String((deal as any).nickname).trim(),
  );

  if (!hasDisplayName && !hasNickname) {
    missing.push("deal_name");
  }

  if (!deal.borrower_id) {
    missing.push("borrower");
  }

  const lifecycleStage = lookupDiagnostics.lifecycleStage;
  if (!lifecycleStage || !INTAKE_COMPLETE_STAGES.has(lifecycleStage)) {
    missing.push("intake_lifecycle");
  }

  const creditSnapshotReady = await hasCreditSnapshot(sb, dealId);
  if (!creditSnapshotReady) {
    missing.push("credit_snapshot");
  }

  if (missing.length > 0) {
    await logAttemptEvent(bankId, false, "complete_intake", {
      ...lookupDiagnostics,
      missing,
    });
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "complete_intake",
      diagnostics: { ...lookupDiagnostics, missing },
      ledgerEventsWritten,
    };
  }

  const { data: checklistRows } = await sb
    .from("deal_checklist_items")
    .select("checklist_key, required, received_at")
    .eq("deal_id", dealId)
    .eq("required", true);

  const requiredItems = (checklistRows ?? []) as Array<{
    checklist_key: string | null;
    received_at: string | null;
  }>;
  const missingRequired = requiredItems.filter((item) => !item.received_at);

  if (requiredItems.length === 0 || missingRequired.length > 0) {
    const missingChecklistKeys = missingRequired.map((item) =>
      String(item.checklist_key ?? "missing"),
    );
    await logAttemptEvent(bankId, false, "checklist_incomplete", {
      ...lookupDiagnostics,
      missing:
        requiredItems.length === 0 ? ["required_checklist"] : missingChecklistKeys,
    });
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "checklist_incomplete",
      diagnostics: {
        ...lookupDiagnostics,
        missing:
          requiredItems.length === 0 ? ["required_checklist"] : missingChecklistKeys,
      },
      ledgerEventsWritten,
    };
  }

  const lockedQuoteId = await latestQuote(sb, dealId);
  if (!lockedQuoteId) {
    await logAttemptEvent(bankId, false, "pricing_required", {
      ...lookupDiagnostics,
      missing: ["pricing_quote"],
    });
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "pricing_required",
      diagnostics: { ...lookupDiagnostics, missing: ["pricing_quote"] },
      ledgerEventsWritten,
    };
  }

  await logAttemptEvent(bankId, true, null, lookupDiagnostics);
  return {
    ok: true,
    dealId,
    redirectTo: `/deals/${dealId}/underwrite`,
    ledgerEventsWritten,
  };
}
