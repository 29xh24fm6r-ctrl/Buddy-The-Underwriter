import type { SupabaseClient } from "@supabase/supabase-js";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";

export type VerifyUnderwriteRecommendedNextAction =
  | "complete_intake"
  | "checklist_incomplete"
  | "pricing_required"
  | "deal_not_found";

export type VerifyUnderwriteSuccess = {
  ok: true;
  dealId: string;
  redirectTo: `/underwrite/${string}`;
  ledgerEventsWritten: string[];
};

export type VerifyUnderwriteBlocked = {
  ok: false;
  dealId: string;
  auth: true;
  recommendedNextAction: VerifyUnderwriteRecommendedNextAction;
  diagnostics: {
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
  const { dealId, actor = "banker", logAttempt = false, deps } = params;
  const { sb, logLedgerEvent: ledger, getLatestLockedQuoteId: latestQuote } = deps;

  const ledgerEventsWritten: string[] = [];

  const logAttemptEvent = async (
    bankId: string | null,
    allowed: boolean,
    reason: VerifyUnderwriteRecommendedNextAction,
    missing?: string[],
  ) => {
    if (!logAttempt || !bankId) return;
    await ledger({
      dealId,
      bankId,
      eventKey: "deal.underwrite.attempted",
      uiState: "done",
      uiMessage: "Underwrite verify attempted",
      meta: {
        deal_id: dealId,
        bank_id: bankId,
        allowed,
        reason,
        missing: missing ?? [],
        actor,
        timestamp: new Date().toISOString(),
      },
    });
    ledgerEventsWritten.push("deal.underwrite.attempted");
  };

  const { data: deal, error } = await sb
    .from("deals")
    .select("id, bank_id, name, borrower_id, lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  if (error || !deal) {
    await logAttemptEvent(null, false, "deal_not_found");
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "deal_not_found",
      diagnostics: {},
      ledgerEventsWritten,
    };
  }

  const bankId = deal.bank_id ? String(deal.bank_id) : null;
  const missing: string[] = [];

  if (!deal.name || deal.name === "NEEDS NAME") {
    missing.push("deal_name");
  }

  if (!deal.borrower_id) {
    missing.push("borrower");
  }

  const lifecycleStage = deal.lifecycle_stage ? String(deal.lifecycle_stage) : null;
  if (!lifecycleStage || !INTAKE_COMPLETE_STAGES.has(lifecycleStage)) {
    missing.push("intake_lifecycle");
  }

  const creditSnapshotReady = await hasCreditSnapshot(sb, dealId);
  if (!creditSnapshotReady) {
    missing.push("credit_snapshot");
  }

  if (missing.length > 0) {
    await logAttemptEvent(bankId, false, "complete_intake", missing);
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "complete_intake",
      diagnostics: { missing, lifecycleStage },
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
    await logAttemptEvent(bankId, false, "checklist_incomplete", missingChecklistKeys);
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "checklist_incomplete",
      diagnostics: {
        missing: requiredItems.length === 0 ? ["required_checklist"] : missingChecklistKeys,
        lifecycleStage,
      },
      ledgerEventsWritten,
    };
  }

  const lockedQuoteId = await latestQuote(sb, dealId);
  if (!lockedQuoteId) {
    await logAttemptEvent(bankId, false, "pricing_required", ["pricing_quote"]);
    return {
      ok: false,
      auth: true,
      dealId,
      recommendedNextAction: "pricing_required",
      diagnostics: { missing: ["pricing_quote"], lifecycleStage },
      ledgerEventsWritten,
    };
  }

  return {
    ok: true,
    dealId,
    redirectTo: `/underwrite/${dealId}`,
    ledgerEventsWritten,
  };
}
