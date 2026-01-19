import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuilderLifecycleSignal } from "@/lib/buddy/builderSignals";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";

export type UnderwritingActivationStatus =
  | "activated"
  | "already_activated"
  | "blocked"
  | "failed";

export type EnsureUnderwritingActivatedDeps = {
  sb: any;
  logLedgerEvent: typeof logLedgerEvent;
  emitBuilderLifecycleSignal: typeof emitBuilderLifecycleSignal;
  advanceDealLifecycle: typeof advanceDealLifecycle;
};

export type EnsureUnderwritingActivatedParams = {
  dealId: string;
  bankId?: string | null;
  trigger?: string;
  deps: EnsureUnderwritingActivatedDeps;
};

export async function ensureUnderwritingActivatedCore(
  params: EnsureUnderwritingActivatedParams,
) {
  const { dealId, bankId, trigger = "underwrite.page", deps } = params;
  const { sb, logLedgerEvent: ledger, advanceDealLifecycle: lifecycle, emitBuilderLifecycleSignal: emitSignal } = deps;

  const logLedger = async (
    eventKey: string,
    uiMessage: string,
    resolvedBankId: string | null,
    meta?: Record<string, unknown>,
  ) => {
    if (!resolvedBankId) return;
    await ledger({
      dealId,
      bankId: resolvedBankId,
      eventKey,
      uiState: "done",
      uiMessage,
      meta: {
        source: "system",
        trigger,
        deal_id: dealId,
        bank_id: resolvedBankId,
        ...meta,
      },
    });
  };

  try {
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id, lifecycle_stage")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal) {
      return { ok: false, status: "failed", error: "deal_not_found" } as const;
    }

    const resolvedBankId = bankId ?? (deal.bank_id ? String(deal.bank_id) : null);

    await logLedger("underwriting.entry.hit", "Underwriting entry hit", resolvedBankId);

    if (deal.lifecycle_stage === "underwriting" || deal.lifecycle_stage === "ready") {
      await logLedger(
        "underwriting.already_activated",
        "Underwriting already activated",
        resolvedBankId,
      );

      await emitSignal({
        dealId,
        phase: "underwrite.activation",
        state: "already_activated",
        trigger,
        note: "Underwriting already active",
      });

      return { ok: true, status: "already_activated" } as const;
    }

    const { data: checklist } = await sb
      .from("deal_checklist_items")
      .select("checklist_key, required, received_at")
      .eq("deal_id", dealId);

    const requiredItems = (checklist ?? []).filter((item: any) => item.required);
    const missing = requiredItems.filter((item: any) => !item.received_at);

    if (requiredItems.length === 0 || missing.length > 0) {
      await logLedger(
        "underwriting.activate_failed",
        "Underwriting blocked by missing required items",
        resolvedBankId,
        {
          reason: requiredItems.length === 0 ? "no_required_items" : "missing_required",
          missing_count: missing.length,
        },
      );

      await emitSignal({
        dealId,
        phase: "underwrite.activation",
        state: "blocked",
        trigger,
        note:
          requiredItems.length === 0
            ? "No required checklist items defined"
            : `Missing required items: ${missing.length}`,
      });

      return {
        ok: true,
        status: "blocked",
        missing: missing.map((item: any) => String(item.checklist_key ?? "missing")),
      } as const;
    }

    const lifecycleResult = await lifecycle({
      dealId,
      toStage: "underwriting",
      reason: "underwriting_started",
      source: "underwrite_entry",
      actor: { userId: null, type: "system", label: "underwrite_entry" },
    });

    if (!lifecycleResult.ok) {
      await logLedger(
        "underwriting.activate_failed",
        "Underwriting activation failed",
        resolvedBankId,
        { reason: lifecycleResult.error ?? "activation_failed" },
      );

      await emitSignal({
        dealId,
        phase: "underwrite.activation",
        state: "failed",
        trigger,
        note: lifecycleResult.error ?? "activation_failed",
      });

      return { ok: false, status: "failed", error: lifecycleResult.error } as const;
    }

    await logLedger(
      "underwriting.activated",
      "Underwriting activated",
      resolvedBankId,
    );

    await emitSignal({
      dealId,
      phase: "underwrite.activation",
      state: "activated",
      trigger,
      note: "Underwriting activated",
    });

    return { ok: true, status: "activated" } as const;
  } catch (error: any) {
    const message = error?.message ?? String(error);
    await emitSignal({
      dealId,
      phase: "underwrite.activation",
      state: "failed",
      trigger,
      note: message,
    });
    return { ok: false, status: "failed", error: message } as const;
  }
}
