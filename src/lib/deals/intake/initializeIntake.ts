import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildChecklistForLoanType } from "@/lib/deals/checklistPresets";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { emitLifecycleSignal } from "@/lib/buddy/signals/lifecycle";

const DEFAULT_LOAN_TYPE = "CRE_OWNER_OCCUPIED";

export async function initializeIntake(dealId: string, bankId: string, opts?: { reason?: string }) {
  const sb = supabaseAdmin();
  const reason = opts?.reason ?? "auto-init";

  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id, lifecycle_stage")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || (deal.bank_id && String(deal.bank_id) !== String(bankId))) {
    return { ok: false, error: "deal_not_found" } as const;
  }

  const { data: intake } = await sb
    .from("deal_intake")
    .select("id, loan_type")
    .eq("deal_id", dealId)
    .maybeSingle();

  let loanType = String(intake?.loan_type || DEFAULT_LOAN_TYPE);
  let intakeInitialized = Boolean(intake?.id);

  if (!intake) {
    const insertPayload: Record<string, any> = {
      deal_id: dealId,
      bank_id: bankId,
      loan_type: loanType,
    };

    const insert = await sb.from("deal_intake").insert(insertPayload as any);
    if (insert.error) {
      const msg = String(insert.error.message || "");
      if (msg.toLowerCase().includes("bank_id") && msg.toLowerCase().includes("does not exist")) {
        await sb.from("deal_intake").insert({
          deal_id: dealId,
          loan_type: loanType,
        } as any);
      } else {
        throw insert.error;
      }
    }
    intakeInitialized = true;
  } else if (!intake.loan_type) {
    await sb
      .from("deal_intake")
      .update({ loan_type: loanType })
      .eq("deal_id", dealId);
    intakeInitialized = true;
  }

  const shouldInitLifecycle = !deal.lifecycle_stage || deal.lifecycle_stage === "created";
  if (shouldInitLifecycle && intakeInitialized) {
    await sb.from("deals").update({ lifecycle_stage: "intake" }).eq("id", dealId);

    await writeEvent({
      dealId,
      kind: "intake.initialized",
      actorUserId: null,
      input: { reason, loan_type: loanType },
    });

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "intake.initialized",
      uiState: "done",
      uiMessage: "Intake initialized",
      meta: { reason, loan_type: loanType },
    });

    emitLifecycleSignal({
      dealId,
      phase: "intake",
      state: "initialized",
      confidence: "high",
      nextUnblock: "underwriting",
    });
  }

  let checklistSeeded = false;
  const { count: existingChecklist } = await sb
    .from("deal_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  if (!existingChecklist || existingChecklist === 0) {
    const checklistRows = buildChecklistForLoanType(loanType as any).map((row) => ({
      deal_id: dealId,
      bank_id: bankId,
      checklist_key: row.checklist_key,
      title: row.title,
      description: row.description ?? null,
      required: row.required,
    }));

    if (checklistRows.length > 0) {
      const seed = await sb
        .from("deal_checklist_items")
        .upsert(checklistRows as any, { onConflict: "deal_id,checklist_key" });

      if (seed.error) {
        const fallbackRows = checklistRows.map((row) => {
          const next = { ...row } as any;
          delete next.bank_id;
          return next;
        });
        await sb
          .from("deal_checklist_items")
          .upsert(fallbackRows as any, { onConflict: "deal_id,checklist_key" });
      }

      checklistSeeded = true;
      await writeEvent({
        dealId,
        kind: "checklist.seeded",
        actorUserId: null,
        input: { reason, loan_type: loanType, item_count: checklistRows.length },
      });

      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "checklist.seeded",
        uiState: "done",
        uiMessage: `Checklist seeded (${checklistRows.length} items)`,
        meta: { reason, loan_type: loanType, item_count: checklistRows.length },
      });
    }
  }

  if (checklistSeeded && (deal.lifecycle_stage === "intake" || shouldInitLifecycle)) {
    await advanceDealLifecycle({
      dealId,
      toStage: "collecting",
      reason: "checklist_seeded",
      source: "auto_init",
      actor: { userId: null, type: "system", label: "auto-init" },
    });
  }

  return { ok: true, intakeInitialized, checklistSeeded, loanType } as const;
}
