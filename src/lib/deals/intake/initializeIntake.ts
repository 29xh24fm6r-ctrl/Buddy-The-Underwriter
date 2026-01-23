import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildChecklistForLoanType } from "@/lib/deals/checklistPresets";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { normalizeGoogleError } from "@/lib/google/errors";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { emitBuilderLifecycleSignal } from "@/lib/buddy/builderSignals";

const DEFAULT_LOAN_TYPE = "CRE_OWNER_OCCUPIED";

type InitializeIntakeTrigger =
  | "context"
  | "files.record"
  | "borrower-request"
  | "borrower_invite"
  | "borrower_upload"
  | "underwrite_start"
  | "underwrite.page"
  | "auto";

export async function initializeIntake(
  dealId: string,
  bankId?: string | null,
  opts?: { reason?: string; trigger?: InitializeIntakeTrigger }
) {
  const sb = supabaseAdmin();
  const reason = opts?.reason ?? "auto-init";
  const trigger = opts?.trigger ?? "auto";
  let resolvedBankId: string | null = bankId ?? null;

  try {
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id, lifecycle_stage")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal) {
      return { ok: false, error: "deal_not_found" } as const;
    }

    resolvedBankId = resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : null);

    if (resolvedBankId && deal.bank_id && String(deal.bank_id) !== String(resolvedBankId)) {
      return { ok: false, error: "tenant_mismatch" } as const;
    }

    const { data: intake } = await sb
      .from("deal_intake")
      .select("id, loan_type")
      .eq("deal_id", dealId)
      .maybeSingle();

    const loanType = String(intake?.loan_type || DEFAULT_LOAN_TYPE);
    let intakeInitialized = Boolean(intake?.id);

    const { data: existingLedger } = await sb
      .from("deal_pipeline_ledger")
      .select("id")
      .eq("deal_id", dealId)
      .eq("event_key", "pipeline.intake.initialized")
      .limit(1)
      .maybeSingle();

    const { count: existingChecklist } = await sb
      .from("deal_checklist_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const alreadyInitialized = Boolean(existingLedger?.id) || Boolean(existingChecklist && existingChecklist > 0);

    if (!intake) {
      const insertPayload: Record<string, any> = {
        deal_id: dealId,
        loan_type: loanType,
      };

      if (resolvedBankId) {
        insertPayload.bank_id = resolvedBankId;
      }

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
    }

    if (!alreadyInitialized && intakeInitialized) {
      await writeEvent({
        dealId,
        kind: "intake.initialized",
        actorUserId: null,
        input: { reason, loan_type: loanType },
      });

      await logLedgerEvent({
        dealId,
        bankId: resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : ""),
        eventKey: "pipeline.intake.initialized",
        uiState: "done",
        uiMessage: "Intake initialized",
        meta: {
          source: "system",
          trigger,
          result: "created",
          reason,
          loan_type: loanType,
          deal_id: dealId,
          bank_id: resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : null),
        },
      });

      void emitBuilderLifecycleSignal({
        dealId,
        phase: "intake",
        state: "initialized",
        trigger,
        checklistCount: existingChecklist ?? 0,
        note: "Auto-initialized intake to unblock underwriting",
      });
    }

    let checklistSeeded = false;
    if (!existingChecklist || existingChecklist === 0) {
        const checklistRows = buildChecklistForLoanType(loanType as any).map((row) => {
          const next: Record<string, any> = {
            deal_id: dealId,
            checklist_key: row.checklist_key,
            title: row.title,
            description: row.description ?? null,
            required: row.required,
          };

          if (resolvedBankId) {
            next.bank_id = resolvedBankId;
          }

          return next;
        });

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
          bankId: resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : ""),
          eventKey: "pipeline.checklist.seeded",
          uiState: "done",
          uiMessage: `Checklist seeded (${checklistRows.length} items)`,
          meta: {
            source: "system",
            trigger,
            result: "created",
            reason,
            loan_type: loanType,
            item_count: checklistRows.length,
            deal_id: dealId,
            bank_id: resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : null),
          },
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

    if (alreadyInitialized) {
      await logLedgerEvent({
        dealId,
        bankId: resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : ""),
        eventKey: "pipeline.intake.already_initialized",
        uiState: "done",
        uiMessage: "Intake already initialized",
        meta: {
          source: "system",
          trigger,
          result: "already_initialized",
          deal_id: dealId,
          bank_id: resolvedBankId ?? (deal.bank_id ? String(deal.bank_id) : null),
        },
      });

      void emitBuilderLifecycleSignal({
        dealId,
        phase: "intake",
        state: "already_initialized",
        trigger,
        checklistCount: existingChecklist ?? 0,
        note: "Intake already initialized",
      });
    }

    const status = alreadyInitialized ? "already_initialized" : "initialized";
    return { ok: true, status, intakeInitialized, checklistSeeded, loanType } as const;
  } catch (error: any) {
    const normalized = normalizeGoogleError(error);
    const rawMessage = String(error?.message ?? String(error));
    const truncated = rawMessage.length > 400 ? `${rawMessage.slice(0, 399)}…` : rawMessage;
    const isRetryableUnknown = normalized.code === "GOOGLE_UNKNOWN";
    try {
      if (!isRetryableUnknown) {
        await logLedgerEvent({
          dealId,
          bankId: resolvedBankId ?? "",
          eventKey: "pipeline.intake.init_failed",
          uiState: "done",
          uiMessage: "Intake auto-init failed",
          meta: {
            source: "system",
            trigger,
            result: "failed",
            deal_id: dealId,
            bank_id: resolvedBankId ?? null,
            error_code: normalized.code,
            error_message: truncated,
          },
        });
        await logLedgerEvent({
          dealId,
          bankId: resolvedBankId ?? "",
          eventKey: "deal.intake.failed",
          uiState: "done",
          uiMessage: `Intake failed: ${normalized.code}`,
          meta: {
            trigger,
            error_code: normalized.code,
            error_message: truncated,
          },
        });
      } else {
        await logLedgerEvent({
          dealId,
          bankId: resolvedBankId ?? "",
          eventKey: "deal.intake.retrying",
          uiState: "waiting",
          uiMessage: "Intake retrying",
          meta: {
            trigger,
            error_code: normalized.code,
            error_message: truncated,
          },
        });
      }
    } catch (logError) {
      console.error("[intake] failed to log init_failed", logError);
    }
    void emitBuilderLifecycleSignal({
      dealId,
      phase: "intake",
      state: isRetryableUnknown ? "retrying" : "failed",
      trigger,
      note: error?.message ?? String(error),
    });
    return { ok: false, error: error?.message ?? String(error) } as const;
  }
}
