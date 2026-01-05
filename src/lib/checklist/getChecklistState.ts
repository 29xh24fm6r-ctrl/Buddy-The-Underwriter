import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

type ChecklistState = "empty" | "processing" | "ready";

export type ChecklistStateResponse = {
  ok: true;
  state: ChecklistState;
  dealId: string;
  totalItems: number;
  received: number;
  pending: number;
  optional: number;
  items?: any[];
  meta?: {
    latestEvent?: {
      stage: string;
      status: string;
      created_at: string;
      payload: any;
    } | null;
  };
};

export type ChecklistErrResponse = {
  ok: false;
  error: string;
  details?: any;
};

function isRecent(iso: string, seconds: number) {
  const t = new Date(iso).getTime();
  return Date.now() - t < seconds * 1000;
}

export async function getChecklistState(args: {
  dealId: string;
  includeItems?: boolean;
}): Promise<ChecklistStateResponse | ChecklistErrResponse> {
  try {
    const { dealId, includeItems } = args;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Server-side access check (do not rely on checklist RLS)
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .single();
    if (dealErr) return { ok: false, error: "Database error loading deal", details: dealErr };
    if (!deal || deal.bank_id !== bankId) return { ok: false, error: "Unauthorized" };

    // Latest pipeline event (used to infer "processing")
    const { data: latestEvent } = await sb
      .from("deal_pipeline_ledger")
      .select("stage,status,created_at,payload")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fetch checklist rows
    const sel = includeItems
      ? "id,deal_id,checklist_key,status,requested_at,received_at,received_upload_id,title,description,required,satisfied_at,satisfaction_json,created_at,updated_at"
      : "id,status,required";

    const { data: rows, error: rowsErr } = await sb
      .from("deal_checklist_items")
      .select(sel)
      .eq("deal_id", dealId);
      
    if (rowsErr) {
      return { ok: false, error: "Database error loading checklist", details: rowsErr };
    }

    const items = rows ?? [];
    const totalItems = items.length;
    const received = items.filter((r: any) => r.status === "received" || r.status === "satisfied").length;
    const pending = items.filter((r: any) => r.status === "pending" || r.status === "missing").length;
    const optional = items.filter((r: any) => r.required === false).length;

    // Derive state
    let state: ChecklistState = "ready";
    if (totalItems === 0) state = "empty";

    // If the ledger indicates the system is actively converging, show processing
    if (latestEvent?.created_at && isRecent(latestEvent.created_at, 30)) {
      if (
        latestEvent.stage === "auto_seed" ||
        latestEvent.stage === "upload" ||
        latestEvent.stage === "readiness"
      ) {
        if (totalItems === 0) state = "processing";
      }
    }

    return {
      ok: true,
      state,
      dealId,
      totalItems,
      received,
      pending,
      optional,
      ...(includeItems ? { items } : {}),
      meta: { latestEvent: latestEvent ?? null },
    };
  } catch (e: any) {
    return { ok: false, error: "Unexpected error", details: String(e?.message ?? e) };
  }
}
