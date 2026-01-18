type SupabaseAdminFn = () => any;
type WriteEventFn = (args: any) => Promise<{ ok: boolean; error?: string }>;
type LogLedgerEventFn = (args: any) => Promise<void>;

export type DealLifecycleStage =
  | "created"
  | "intake"
  | "collecting"
  | "underwriting"
  | "ready";

export type LifecycleActor = {
  userId?: string | null;
  type?: "user" | "system";
  label?: string;
};

const ALLOWED_TRANSITIONS: Record<DealLifecycleStage, DealLifecycleStage[]> = {
  created: ["intake"],
  intake: ["collecting"],
  collecting: ["underwriting"],
  underwriting: ["ready"],
  ready: [],
};

export async function advanceDealLifecycle(params: {
  dealId: string;
  toStage: DealLifecycleStage;
  reason: string;
  source: string;
  actor: LifecycleActor;
  deps?: {
    sb?: any;
    writeEvent?: WriteEventFn;
    logLedgerEvent?: LogLedgerEventFn;
  };
}) {
  const { dealId, toStage, reason, source, actor, deps } = params;

  const defaults = async () => {
    const [sbMod, ledgerMod, pipelineMod] = await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/ledger/writeEvent"),
      import("@/lib/pipeline/logLedgerEvent"),
    ]);
    return {
      supabaseAdmin: sbMod.supabaseAdmin as SupabaseAdminFn,
      writeEvent: ledgerMod.writeEvent as WriteEventFn,
      logLedgerEvent: pipelineMod.logLedgerEvent as LogLedgerEventFn,
    };
  };

  const defaultDeps = deps?.sb && deps?.writeEvent && deps?.logLedgerEvent ? null : await defaults();
  const sb = deps?.sb ?? defaultDeps?.supabaseAdmin();
  const ledgerWrite = deps?.writeEvent ?? defaultDeps?.writeEvent;
  const pipelineLog = deps?.logLedgerEvent ?? defaultDeps?.logLedgerEvent;

  if (toStage === "intake") {
    return { ok: false, error: "use_ignite" } as const;
  }

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    return { ok: false, error: "Deal not found" } as const;
  }

  const current = (deal.lifecycle_stage as DealLifecycleStage) || "created";
  if (current === toStage) {
    return { ok: true, already: true, stage: current } as const;
  }

  const allowed = ALLOWED_TRANSITIONS[current] ?? [];
  if (!allowed.includes(toStage)) {
    return {
      ok: false,
      error: "invalid_transition",
      from: current,
      to: toStage,
    } as const;
  }

  const { error: updateErr } = await sb
    .from("deals")
    .update({ lifecycle_stage: toStage })
    .eq("id", dealId);

  if (updateErr) {
    return { ok: false, error: "Failed to update lifecycle" } as const;
  }

  await ledgerWrite({
    dealId,
    kind: "deal.lifecycle_advanced",
    actorUserId: actor.userId ?? null,
    input: {
      from: current,
      to: toStage,
      reason,
      source,
      actor,
    },
  });

  await pipelineLog({
    dealId,
    bankId: deal.bank_id,
    eventKey: "deal.lifecycle_advanced",
    uiState: "done",
    uiMessage: `Lifecycle advanced: ${current} → ${toStage}`,
    meta: {
      from: current,
      to: toStage,
      reason,
      source,
      actor,
    },
  });

  return { ok: true, from: current, to: toStage } as const;
}
