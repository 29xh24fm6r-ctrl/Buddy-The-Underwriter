import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycleCore";
import { LedgerEventType } from "@/buddy/lifecycle/events";

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
    .select("id, bank_id, stage")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return { ok: false, error: "Deal not found" } as const;
  }

  if (deal.bank_id && String(deal.bank_id) !== String(bankId)) {
    return { ok: false, error: "Deal not found" } as const;
  }

  if (deal.stage && deal.stage !== "created") {
    return { ok: true, already: true, stage: deal.stage } as const;
  }

  const { data: intake } = await sb
    .from("deal_intake")
    .select("loan_type")
    .eq("deal_id", dealId)
    .maybeSingle();

  const loanType = String(intake?.loan_type || "CRE") || "CRE";

  // ── Step 1: Seed checklist BEFORE lifecycle advance ────────────
  // If seed fails the deal stays in "created" — never orphaned in "intake" without a checklist.
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

  if (!seededOk) {
    await ledgerWrite({
      dealId,
      kind: LedgerEventType.checklist_seed_failed,
      actorUserId: triggeredByUserId,
      input: { loanType, source },
    });
    return { ok: false, error: "checklist_seed_failed" } as const;
  }

  // ── Step 1.5: Seed core document slots (Phase 15) ──────────────
  try {
    const { ensureCoreDocumentSlots } = await import(
      "@/lib/intake/slots/ensureCoreDocumentSlots"
    );
    await ensureCoreDocumentSlots({ dealId, bankId });
  } catch (slotErr: any) {
    // Non-fatal: slots can be seeded later
    console.warn("[igniteDeal] ensureCoreDocumentSlots failed (non-fatal)", {
      dealId,
      error: slotErr?.message,
    });
  }

  // ── Step 2: Advance lifecycle to "intake" (checklist is guaranteed) ──
  const { error: updErr } = await sb
    .from("deals")
    .update({ stage: "intake" })
    .eq("id", dealId);

  if (updErr) {
    return { ok: false, error: "Failed to update deal lifecycle" } as const;
  }

  // ── Step 3: Write ledger events ────────────────────────────────
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

  await ledgerWrite({
    dealId,
    kind: LedgerEventType.checklist_seeded,
    actorUserId: triggeredByUserId,
    input: {
      source: source === "banker_invite" ? "ignite" : "banker_upload",
      item_count: checklistRows.length,
    },
  });

  await pipelineLog({
    dealId,
    bankId,
    eventKey: LedgerEventType.checklist_seeded,
    uiState: "done",
    uiMessage: `Checklist seeded (${checklistRows.length} items)`,
    meta: {
      source: source === "banker_invite" ? "ignite" : "banker_upload",
      item_count: checklistRows.length,
    },
  });

  // ── Step 4: Advance to "collecting" ────────────────────────────
  await advanceLifecycle({
    dealId,
    toStage: "collecting",
    reason: "checklist_seeded",
    source,
    actor: { userId: triggeredByUserId, type: "user" },
  });

  await ensurePortal(dealId);

  try {
    const [{ verifyUnderwriteCore }, { getLatestLockedQuoteId }] = await Promise.all([
      import("@/lib/deals/verifyUnderwriteCore"),
      import("@/lib/pricing/getLatestLockedQuote"),
    ]);
    await verifyUnderwriteCore({
      dealId,
      actor: "system",
      logAttempt: true,
      verifySource: "runtime",
      verifyDetails: {
        url: "internal://igniteDeal",
        auth: true,
        html: false,
        metaFallback: false,
        redacted: true,
      },
      deps: {
        sb,
        logLedgerEvent: pipelineLog,
        getLatestLockedQuoteId,
      },
    });
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[igniteDeal] verify-underwrite logging failed", e);
    }
  }

  emitSignal({
    type: "deal.ignited",
    source: "lib/deals/igniteDeal",
    ts: Date.now(),
    dealId,
    payload: { source, triggered_by_user_id: triggeredByUserId },
  });

  return { ok: true } as const;
}
