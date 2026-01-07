import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import type { ChecklistItem } from "@/types/db";
import { getChecklistState } from "@/lib/checklist/getChecklistState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKLIST_DEFINITIONS: Record<string, { title: string; required: boolean }> = {
  PFS_CURRENT: { title: "Personal Financial Statement (current)", required: true },
  IRS_BUSINESS_2Y: { title: "Business tax returns (last 2 years)", required: true },
  IRS_PERSONAL_2Y: { title: "Personal tax returns (last 2 years)", required: true },
  FIN_STMT_YTD: { title: "Year-to-date financial statement", required: true },
  AR_AP_AGING: { title: "A/R and A/P aging", required: false },
  BANK_STMT_3M: { title: "Bank statements (last 3 months)", required: false },
  SBA_1919: { title: "SBA Form 1919", required: false },
  SBA_912: { title: "SBA Form 912 (Statement of Personal History)", required: false },
  SBA_413: { title: "SBA Form 413 (PFS)", required: false },
  SBA_DEBT_SCHED: { title: "Business debt schedule", required: false },
};

/**
 * GET /api/deals/[dealId]/checklist/list
 * 
 * Returns full checklist items array with v2 satisfaction fields
 * CONVERGENCE-SAFE: Returns state:"processing" instead of 500 during auto-seed/upload
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    
    // Use convergence-safe helper
    const checklistState = await getChecklistState({ dealId, includeItems: true });
    
    console.log('[checklist/list] getChecklistState result:', {
      ok: checklistState.ok,
      state: checklistState.ok ? checklistState.state : 'error',
      totalItems: checklistState.ok ? checklistState.totalItems : 0,
      itemsLength: checklistState.ok ? checklistState.items?.length : 0
    });
    
    if (!checklistState.ok) {
      const status = checklistState.error === "Unauthorized" ? 403 : 500;
      return NextResponse.json({ 
        ok: false, 
        items: [], 
        error: checklistState.error 
      }, { status });
    }
    
    // If empty, return early (no items to format)
    if (checklistState.state === "empty") {
      console.log('[checklist/list] Returning empty state');
      return NextResponse.json({
        ok: true,
        state: "empty",
        items: [],
        meta: checklistState.meta,
      });
    }

    // If processing, return calm state (and do not misreport as ready)
    if (checklistState.state === "processing") {
      console.log('[checklist/list] Returning processing state');
      return NextResponse.json({
        ok: true,
        state: "processing",
        items: [],
        meta: checklistState.meta,
      });
    }

    // Format items (for both "ready" and "processing" states)
    const items = (checklistState.items ?? []).map((row: any) => ({
      id: row.id,
      deal_id: row.deal_id,
      checklist_key: row.checklist_key,
      title: row.title ?? CHECKLIST_DEFINITIONS[row.checklist_key]?.title ?? row.checklist_key,
      description: row.description ?? null,
      required: !!row.required,
      status: row.status ?? "missing",
      received_at: row.received_at,
      satisfied_at: row.satisfied_at,
      satisfaction_json: row.satisfaction_json,
      created_at: row.created_at,
    }));

    // Sort: required first, then by created_at
    items.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      if (a.created_at && b.created_at && a.created_at !== b.created_at) {
        return String(a.created_at).localeCompare(String(b.created_at));
      }
      return String(a.checklist_key).localeCompare(String(b.checklist_key));
    });

    return NextResponse.json({
      ok: true,
      state: "ready",
      items,
      meta: checklistState.meta,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist/list] Unexpected error:", error);
    return NextResponse.json({ 
      ok: false, 
      items: [], 
      error: error?.message || "Unexpected error loading checklist" 
    }, { status: 500 });
  }
}
