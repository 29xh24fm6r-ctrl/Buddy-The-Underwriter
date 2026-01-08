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

    // Fetch checklist rows.
    // IMPORTANT: Be schema-tolerant: try selecting v2 fields, then fall back.
    const baseSel = includeItems
      ? "id,deal_id,checklist_key,status,required,title,description,created_at,received_at,satisfied_at,satisfaction_json,required_years,satisfied_years"
      : "id,status,required";

    let rows: any[] | null = null;
    let rowsErr: any = null;
    {
      const attempt = await sb
        .from("deal_checklist_items")
        .select(baseSel)
        .eq("deal_id", dealId);

      rows = attempt.data;
      rowsErr = attempt.error;

      if (rowsErr && includeItems) {
        const msg = String((rowsErr as any)?.message ?? rowsErr?.toString() ?? "");
        if (
          msg.toLowerCase().includes("does not exist") &&
          (msg.includes("required_years") ||
            msg.includes("satisfied_years") ||
            msg.includes("received_at") ||
            msg.includes("satisfied_at") ||
            msg.includes("satisfaction_json"))
        ) {
          const fallback = await sb
            .from("deal_checklist_items")
            .select("id,deal_id,checklist_key,status,required,title,description,created_at")
            .eq("deal_id", dealId);
          rows = fallback.data;
          rowsErr = fallback.error;
        }
      }
    }
      
    if (rowsErr) {
      const le = latestEvent?.created_at;

      // If the system is actively working on checklist/upload/readiness, never flash red.
      // Avoid getting stuck in "processing" due to unrelated frequent pipeline events.
      if (
        le &&
        isRecent(le, 30) &&
        (latestEvent?.stage === "auto_seed" ||
          latestEvent?.stage === "upload" ||
          latestEvent?.stage === "readiness")
      ) {
        return {
          ok: true,
          state: "processing",
          dealId,
          totalItems: 0,
          received: 0,
          pending: 0,
          optional: 0,
          meta: { latestEvent: latestEvent ?? null },
        };
      }

      // If schema drift or column doesn't exist, return empty state instead of error
      const msg = String((rowsErr as any)?.message ?? rowsErr?.toString() ?? "");
      if (
        msg.includes("does not exist") ||
        msg.includes("relation") ||
        msg.includes("column") ||
        msg.includes("function") ||
        msg.includes("could not find")
      ) {
        console.warn("[getChecklistState] Schema issue detected, returning empty:", msg);
        return {
          ok: true,
          state: "empty",
          dealId,
          totalItems: 0,
          received: 0,
          pending: 0,
          optional: 0,
          meta: { latestEvent: latestEvent ?? null },
        };
      }

      console.error("[getChecklistState] Database error:", rowsErr);
      return { ok: false, error: "Database error loading checklist", details: rowsErr };
    }

    const items = rows ?? [];
    const totalItems = items.length;
    const received = items.filter((r: any) => r.status === "received" || r.status === "satisfied").length;
    const pending = items.filter((r: any) => r.status === "pending" || r.status === "missing").length;
    const optional = items.filter((r: any) => r.required === false).length;

    console.log(`[getChecklistState] dealId=${dealId} totalItems=${totalItems} latestEvent=${latestEvent?.stage}`);

    // Derive state - prioritize actual data over pipeline events
    let state: ChecklistState = "ready";
    
    if (totalItems === 0) {
      // Only show processing if there's a very recent event AND no items
      if (latestEvent?.created_at && isRecent(latestEvent.created_at, 30)) {
        if (
          latestEvent.stage === "auto_seed" ||
          latestEvent.stage === "upload" ||
          latestEvent.stage === "readiness"
        ) {
          state = "processing";
        } else {
          state = "empty";
        }
      } else {
        state = "empty";
      }
    }
    // If items exist, always show ready (don't let pipeline events override actual data)
    
    console.log(`[getChecklistState] final state=${state}`);

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
