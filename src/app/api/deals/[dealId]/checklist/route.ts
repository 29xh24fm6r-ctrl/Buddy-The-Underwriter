import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";
import type { ChecklistItem } from "@/types/db";

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
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // Fetch base checklist items from deal_checklist_items
    const { data: checklistItems, error: checklistError } = await sb
      .from("deal_checklist_items")
      .select("id, deal_id, checklist_key, title, description, required, status, received_at, received_file_id, created_at")
      .eq("deal_id", dealId);

    if (checklistError) {
      console.error("[/api/deals/[dealId]/checklist]", checklistError);
      return NextResponse.json({
        ok: false,
        received: [],
        pending: [],
        optional: [],
        error: "Failed to load checklist",
      });
    }

    // Fetch documents to augment received determination
    const { data: documents, error: docsError } = await sb
      .from("deal_documents")
      .select("checklist_key")
      .eq("deal_id", dealId);

    if (docsError) {
      console.error("[/api/deals/[dealId]/checklist]", docsError);
    }

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
    (checklistItems || []).forEach((item) => {
      // Determine if received: check explicit status OR presence of document
      const hasExplicitReceivedStatus = item.status === "received" || item.received_at !== null;
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
      received,
      pending,
      optional,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist]", error);
    return NextResponse.json({
      ok: false,
      received: [],
      pending: [],
      optional: [],
      error: "Failed to load checklist",
    });
  }
}
