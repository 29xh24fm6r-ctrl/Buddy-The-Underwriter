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
    lifecycleColumn?: "lifecycle_stage" | "lifecycle_state" | null;
    lifecycleError?: string | null;
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

async function fetchDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<{
  deal:
    | {
        id: string;
        bank_id: string | null;
        display_name?: string | null;
        name?: string | null;
        borrower_id?: string | null;
        lifecycle_stage?: string | null;
        lifecycle_state?: string | null;
      }
    | null;
  error: { message?: string } | null;
  lifecycleColumn: "lifecycle_stage" | "lifecycle_state" | null;
  lifecycleStage: string | null;
  lifecycleError: string | null;
}> {
  const baseSelect = "id, bank_id, display_name, name, borrower_id";
  const base = await sb
    .from("deals")
    .select(baseSelect)
    .eq("id", dealId)
    .maybeSingle();

  if (base.error || !base.data) {
    return {
      deal: base.data ?? null,
      error: base.error ?? null,
      lifecycleColumn: null,
      lifecycleStage: null,
      lifecycleError: null,
    };
  }

  const primary = await sb
    .from("deals")
    .select("lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  if (!primary.error) {
    return {
      deal: base.data,
      error: null,
      lifecycleColumn: "lifecycle_stage",
      lifecycleStage: primary.data?.lifecycle_stage ?? null,
      lifecycleError: null,
    };
  }

  if (primary.error?.message?.includes("lifecycle_stage")) {
    const fallback = await sb
      .from("deals")
      .select("lifecycle_state")
      .eq("id", dealId)
      .maybeSingle();
    if (!fallback.error) {
      return {
        deal: base.data,
        error: null,
        lifecycleColumn: "lifecycle_state",
        lifecycleStage: fallback.data?.lifecycle_state ?? null,
        lifecycleError: null,
      };
    }

    return {
      deal: base.data,
      error: null,
      lifecycleColumn: "lifecycle_state",
      lifecycleStage: null,
      lifecycleError: fallback.error?.message ?? null,
    };
  }

  return {
    deal: base.data,
    error: null,
    lifecycleColumn: "lifecycle_stage",
    lifecycleStage: null,
    lifecycleError: primary.error?.message ?? null,
  };
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

  const { deal, error, lifecycleColumn, lifecycleStage, lifecycleError } =
    await fetchDeal(sb, dealId);

  const lookupDiagnostics = {
    dealId,
    lookedIn: ["supabase.deals"],
    foundIn: {
      supabaseDeals: Boolean(deal && !error),
    },
    bankId: deal?.bank_id ? String(deal.bank_id) : null,
    lifecycleStage: lifecycleStage ? String(lifecycleStage) : null,
    lifecycleColumn,
    dbError: error?.message ?? null,
    lifecycleError,
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
  const hasName = Boolean((deal as any)?.name && String((deal as any).name).trim());

  if (!hasDisplayName && !hasName) {
    missing.push("deal_name");
  }

  if (!deal.borrower_id) {
    missing.push("borrower");
  }

  const currentLifecycleStage = lookupDiagnostics.lifecycleStage;
  if (!currentLifecycleStage || !INTAKE_COMPLETE_STAGES.has(currentLifecycleStage)) {
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
