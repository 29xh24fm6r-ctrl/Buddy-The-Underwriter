import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycleCore";

export type IgniteSource = "banker_invite" | "banker_upload";

type SupabaseAdminFn = () => any;
type WriteEventFn = (args: any) => Promise<{ ok: boolean; error?: string }>;
type LogLedgerEventFn = (args: any) => Promise<void>;
type EmitSignalFn = (args: any) => Promise<void>;
type EnsurePortalFn = (dealId: string) => Promise<void>;
type BuildChecklistFn = (loanType: string) => Array<{ checklist_key: string; title: string; required: boolean }>;

type IgniteDeps = {
  sb?: any;
  writeEvent?: WriteEventFn;
  logLedgerEvent?: LogLedgerEventFn;
  emitBuddySignalServer?: EmitSignalFn;
  ensureDefaultPortalStatus?: EnsurePortalFn;
  advanceDealLifecycle?: typeof advanceDealLifecycle;
  buildChecklistForLoanType?: BuildChecklistFn;
};

export async function igniteDeal(params: {
  dealId: string;
  bankId: string;
  source: IgniteSource;
  triggeredByUserId: string;
  deps?: IgniteDeps;
}) {
  const { dealId, bankId, source, triggeredByUserId, deps } = params;
  const defaults = async () => {
    const [sbMod, ledgerMod, pipelineMod, buddyMod, portalMod, checklistMod] = await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/ledger/writeEvent"),
      import("@/lib/pipeline/logLedgerEvent"),
      import("@/buddy/emitBuddySignalServer"),
      import("@/lib/portal/checklist"),
      import("@/lib/deals/checklistPresets"),
    ]);
    return {
      supabaseAdmin: sbMod.supabaseAdmin as SupabaseAdminFn,
      writeEvent: ledgerMod.writeEvent as WriteEventFn,
      logLedgerEvent: pipelineMod.logLedgerEvent as LogLedgerEventFn,
      emitBuddySignalServer: buddyMod.emitBuddySignalServer as EmitSignalFn,
      ensureDefaultPortalStatus: portalMod.ensureDefaultPortalStatus as EnsurePortalFn,
      buildChecklistForLoanType: checklistMod.buildChecklistForLoanType as BuildChecklistFn,
    };
  };

  const hasAllDeps =
    deps?.sb &&
    deps?.writeEvent &&
    deps?.logLedgerEvent &&
    deps?.emitBuddySignalServer &&
    deps?.ensureDefaultPortalStatus;
  const defaultDeps = hasAllDeps ? null : await defaults();

  const sb = deps?.sb ?? defaultDeps?.supabaseAdmin();
  const ledgerWrite = deps?.writeEvent ?? defaultDeps?.writeEvent;
  const pipelineLog = deps?.logLedgerEvent ?? defaultDeps?.logLedgerEvent;
  const emitSignal = deps?.emitBuddySignalServer ?? defaultDeps?.emitBuddySignalServer;
  const ensurePortal = deps?.ensureDefaultPortalStatus ?? defaultDeps?.ensureDefaultPortalStatus;
  const advanceLifecycle = deps?.advanceDealLifecycle ?? advanceDealLifecycle;
  const buildChecklistForLoanType =
    deps?.buildChecklistForLoanType ?? defaultDeps?.buildChecklistForLoanType;

  if (!sb || !ledgerWrite || !pipelineLog || !emitSignal || !ensurePortal || !buildChecklistForLoanType) {
    throw new Error("igniteDeal missing dependencies");
  }

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return { ok: false, error: "Deal not found" } as const;
  }

  if (deal.bank_id && String(deal.bank_id) !== String(bankId)) {
    return { ok: false, error: "Deal not found" } as const;
  }

  if (deal.lifecycle_stage && deal.lifecycle_stage !== "created") {
    return { ok: true, already: true, stage: deal.lifecycle_stage } as const;
  }

  const { data: intake } = await sb
    .from("deal_intake")
    .select("loan_type")
    .eq("deal_id", dealId)
    .maybeSingle();

  const loanType = String(intake?.loan_type || "CRE") || "CRE";

  const { error: updErr } = await sb
    .from("deals")
    .update({ lifecycle_stage: "intake" })
    .eq("id", dealId);

  if (updErr) {
    return { ok: false, error: "Failed to update deal lifecycle" } as const;
  }

  await ledgerWrite({
    dealId,
    kind: "deal.ignited",
    actorUserId: triggeredByUserId,
    input: { source, triggered_by_user_id: triggeredByUserId },
  });

  await pipelineLog({
    dealId,
    bankId,
    eventKey: "deal.ignited",
    uiState: "done",
    uiMessage:
      source === "banker_invite"
        ? "Deal intake started — borrower invited"
        : "Deal intake started — banker uploaded documents",
    meta: { source, triggered_by_user_id: triggeredByUserId },
  });

  const checklistRows = (buildChecklistForLoanType?.(loanType) ?? []).map((row) => ({
    deal_id: dealId,
    bank_id: bankId,
    checklist_key: row.checklist_key,
    title: row.title,
    required: row.required,
  }));

  let seededOk = true;
  if (checklistRows.length > 0) {
    const { error: seedErr } = await sb
      .from("deal_checklist_items")
      .upsert(checklistRows as any, { onConflict: "deal_id,checklist_key" });

    if (seedErr) {
      const fallbackRows = checklistRows.map((row) => {
        const next = { ...row } as any;
        delete next.bank_id;
        return next;
      });
      const { error: fallbackErr } = await sb
        .from("deal_checklist_items")
        .upsert(fallbackRows as any, { onConflict: "deal_id,checklist_key" });
      seededOk = !fallbackErr;
    }
  }

  if (seededOk) {
    await ledgerWrite({
      dealId,
      kind: "deal.checklist.seeded",
      actorUserId: triggeredByUserId,
      input: {
        source: source === "banker_invite" ? "ignite" : "banker_upload",
        item_count: checklistRows.length,
      },
    });

    await pipelineLog({
      dealId,
      bankId,
      eventKey: "deal.checklist.seeded",
      uiState: "done",
      uiMessage: `Checklist seeded (${checklistRows.length} items)`,
      meta: {
        source: source === "banker_invite" ? "ignite" : "banker_upload",
        item_count: checklistRows.length,
      },
    });

    await advanceLifecycle({
      dealId,
      toStage: "collecting",
      reason: "checklist_seeded",
      source,
      actor: { userId: triggeredByUserId, type: "user" },
    });
  }

  await ensurePortal(dealId);

  emitSignal({
    type: "deal.ignited",
    source: "lib/deals/igniteDeal",
    ts: Date.now(),
    dealId,
    payload: { source, triggered_by_user_id: triggeredByUserId },
  });

  return { ok: true } as const;
}
