import { LedgerEventType } from "@/buddy/lifecycle/events";

type SupabaseAdminFn = () => any;
type WriteEventFn = (args: any) => Promise<{ ok: boolean; error?: string }>;
type LogLedgerEventFn = (
  args: any,
) => Promise<void | { ok: boolean; error?: string }>;

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
      logLedgerEvent: pipelineMod.logLedgerEventRequired as LogLedgerEventFn,
    };
  };

  const defaultDeps = deps?.sb && deps?.writeEvent && deps?.logLedgerEvent
    ? null
    : await defaults();
  const sb = deps?.sb ?? defaultDeps?.supabaseAdmin();
  const ledgerWrite = deps?.writeEvent ?? defaultDeps?.writeEvent;
  const pipelineLog = deps?.logLedgerEvent ?? defaultDeps?.logLedgerEvent;

  if (!sb || !ledgerWrite || !pipelineLog) {
    throw new Error("advanceDealLifecycle missing dependencies");
  }

  if (toStage === "intake") {
    return { ok: false, error: "use_ignite" } as const;
  }

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, stage")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) {
    return { ok: false, error: "deal_lookup_failed" } as const;
  }
  if (!deal) {
    return { ok: false, error: "deal_not_found" } as const;
  }
  if (!deal.bank_id) {
    return { ok: false, error: "deal_bank_missing" } as const;
  }

  const current = (deal.stage as DealLifecycleStage) || "created";
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
    .update({ stage: toStage })
    .eq("id", dealId);

  if (updateErr) {
    return { ok: false, error: "lifecycle_update_failed" } as const;
  }

  // Supabase UPDATE can succeed with zero affected rows. Read the authoritative
  // row back before recording completion so RLS, filters, and concurrent writes
  // cannot produce a false successful transition.
  const { data: persisted, error: verifyErr } = await sb
    .from("deals")
    .select("id, stage")
    .eq("id", dealId)
    .maybeSingle();

  if (verifyErr || persisted?.stage !== toStage) {
    return {
      ok: false,
      error: "lifecycle_persistence_unproven",
      from: current,
      to: toStage,
    } as const;
  }

  const ledgerResult = await ledgerWrite({
    dealId,
    kind: LedgerEventType.lifecycle_advanced,
    actorUserId: actor.userId ?? null,
    input: {
      from: current,
      to: toStage,
      reason,
      source,
      actor,
    },
  });

  if (!ledgerResult.ok) {
    return {
      ok: false,
      error: "lifecycle_event_write_failed",
      from: current,
      to: toStage,
      stage_persisted: true,
    } as const;
  }

  const pipelineResult = await pipelineLog({
    dealId,
    bankId: deal.bank_id,
    eventKey: LedgerEventType.lifecycle_advanced,
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

  if (pipelineResult && !pipelineResult.ok) {
    return {
      ok: false,
      error: "pipeline_event_write_failed",
      from: current,
      to: toStage,
      stage_persisted: true,
      event_persisted: true,
    } as const;
  }

  return { ok: true, from: current, to: toStage } as const;
}
