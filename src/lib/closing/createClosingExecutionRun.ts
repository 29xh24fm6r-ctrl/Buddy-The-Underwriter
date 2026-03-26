import "server-only";

/**
 * Phase 57 — Create Closing Execution Run
 *
 * Initializes a draft execution run from a generated closing package.
 * Seeds condition states from checklist items and default recipients.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

type CreateRunInput = {
  closingPackageId: string;
  dealId: string;
  bankId: string;
  createdBy: string;
};

type CreateRunResult = {
  ok: true;
  executionRunId: string;
  conditionsSeeded: number;
} | {
  ok: false;
  error: string;
};

export async function createClosingExecutionRun(input: CreateRunInput): Promise<CreateRunResult> {
  const sb = supabaseAdmin();
  const { closingPackageId, dealId, bankId, createdBy } = input;

  try {
    // Create execution run
    const { data: run, error: runErr } = await sb
      .from("closing_execution_runs")
      .insert({
        closing_package_id: closingPackageId,
        deal_id: dealId,
        status: "draft",
        created_by: createdBy,
      })
      .select("id")
      .single();

    if (runErr) throw new Error(runErr.message);

    // Seed condition states from checklist items
    const { data: checklistItems } = await sb
      .from("closing_checklist_items")
      .select("id, item_type, title, required, status")
      .eq("closing_package_id", closingPackageId);

    const conditions = (checklistItems ?? []).map((item: any) => ({
      closing_package_id: closingPackageId,
      closing_checklist_item_id: item.id,
      deal_id: dealId,
      condition_code: item.item_type,
      title: item.title,
      category: mapItemTypeToCategory(item.item_type),
      required: item.required,
      status: item.status === "complete" || item.status === "received" ? "satisfied" : "pending",
    }));

    let conditionsSeeded = 0;
    if (conditions.length > 0) {
      await sb.from("closing_condition_states").insert(conditions);
      conditionsSeeded = conditions.length;
    }

    await logLedgerEvent({
      dealId, bankId,
      eventKey: "closing.package.execution.created",
      uiState: "done",
      uiMessage: "Closing execution run created",
      meta: {
        execution_run_id: run.id,
        closing_package_id: closingPackageId,
        conditions_seeded: conditionsSeeded,
        actor: createdBy,
      },
    }).catch(() => {});

    return { ok: true, executionRunId: run.id, conditionsSeeded };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function mapItemTypeToCategory(itemType: string): string {
  const map: Record<string, string> = {
    document_signature: "signature",
    borrower_upload: "document",
    insurance: "insurance",
    title: "collateral",
    entity_certification: "authority",
    guarantor_requirement: "document",
    collateral_requirement: "collateral",
    funding_condition: "disbursement",
    legal_review: "authority",
  };
  return map[itemType] ?? "other";
}
