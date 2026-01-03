import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import type { ChecklistItem } from "@/types/db";
import { isDemoMode, demoState } from "@/lib/demo/demoMode";
import { mockChecklistData } from "@/lib/demo/mocks";
import { getChecklistState } from "@/lib/checklist/getChecklistState";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * GET /api/deals/[dealId]/checklist
 * 
 * Returns checklist state bucketed by status: { ok:true, received:[], pending:[], optional:[] }
 * Base items come from deal_checklist_items, augmented with deal_documents for received determination.
 * 
 * DEMO MODE: Supports ?__mode=demo&__state=empty|converging|ready|blocked
 * CONVERGENCE-SAFE: Returns state:"processing" instead of 500 during auto-seed/upload
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    // Demo mode support
    const searchParams = req.nextUrl.searchParams;
    if (isDemoMode(searchParams)) {
      const state = demoState(searchParams);
      const mockData = mockChecklistData(state);
      
      // Convert mock data to API format
      if (!mockData.ok) {
        return NextResponse.json(mockData, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        state: mockData.state,
        received: mockData.items?.filter(i => i.status === "satisfied" || i.status === "received") ?? [],
        pending: mockData.items?.filter(i => i.status === "missing" || i.status === "pending") ?? [],
        optional: [],
      });
    }
    
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { dealId } = await ctx.params;
    
    // Use convergence-safe helper
    const checklistState = await getChecklistState({ dealId, includeItems: true });
    
    if (!checklistState.ok) {
      const status = checklistState.error === "Unauthorized" ? 403 : 500;
      return NextResponse.json({
        ok: false,
        received: [],
        pending: [],
        optional: [],
        error: checklistState.error,
      }, { status });
    }
    
    // If processing, return calm state (not an error)
    if (checklistState.state === "processing") {
      return NextResponse.json({
        ok: true,
        state: "processing",
        received: [],
        pending: [],
        optional: [],
        meta: checklistState.meta,
      });
    }
    
    // Empty state
    if (checklistState.state === "empty") {
      return NextResponse.json({
        ok: true,
        state: "empty",
        received: [],
        pending: [],
        optional: [],
        meta: checklistState.meta,
      });
    }

    // Ready state: bucket items by status
    const items = checklistState.items ?? [];
    const sb = supabaseAdmin();
    
    // Fetch documents to augment received determination
    const { data: documents } = await sb
      .from("deal_documents")
      .select("checklist_key")
      .eq("deal_id", dealId);

    // Build set of checklist_keys that have documents
    const documentKeys = new Set<string>();
    (documents || []).forEach((doc) => {
      if (doc.checklist_key) {
        documentKeys.add(doc.checklist_key);
      }
    });

    const received: ChecklistItem[] = [];
    const pending: ChecklistItem[] = [];
    const optional: ChecklistItem[] = [];

    // Bucket items based on required flag and received status
    items.forEach((item) => {
      // Determine if received: check explicit status OR presence of document
      const hasExplicitReceivedStatus =
        item.status === "received" ||
        item.status === "satisfied" ||
        item.received_at !== null ||
        // @ts-expect-error - some rows may include v2 fields depending on select
        item.satisfied_at !== null;
      const hasDocument = documentKeys.has(item.checklist_key);
      const isReceived = hasExplicitReceivedStatus || hasDocument;

      if (isReceived) {
        received.push(item);
      } else if (item.required) {
        pending.push(item);
      } else {
        optional.push(item);
      }
    });

    return NextResponse.json({
      ok: true,
      state: "ready",
      received,
      pending,
      optional,
      meta: checklistState.meta,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist] Unexpected error:", error);
    return NextResponse.json({
      ok: false,
      received: [],
      pending: [],
      optional: [],
      error: error?.message || "Unexpected error loading checklist",
    }, { status: 500 });
  }
}
