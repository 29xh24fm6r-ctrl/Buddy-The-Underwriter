import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

type DealEvent = {
  id: string;
  kind: string;
  metadata: Record<string, any>;
  created_at: string;
};

/**
 * GET /api/deals/[dealId]/events
 * 
 * Returns recent deal events for activity feed.
 * Derives events from deal_documents (canonical source) instead of legacy deal_events table.
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { dealId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const sb = supabaseAdmin();

    // Fetch recent document uploads/changes as events
    const { data: documents, error } = await sb
      .from("deal_documents")
      .select("id, original_filename, doc_type, created_at, updated_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[/api/deals/[dealId]/events]", error);
      // Return 200 with empty array to prevent UI breakage
      return NextResponse.json({
        events: [],
      });
    }

    // Transform documents into event format
    const events: DealEvent[] = (documents || []).map((doc) => ({
      id: doc.id,
      kind: "document_uploaded",
      metadata: {
        filename: doc.original_filename,
        doc_type: doc.doc_type,
      },
      created_at: doc.created_at,
    }));

    return NextResponse.json({
      events,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/events]", error);
    // Return 200 with empty array to prevent UI breakage
    return NextResponse.json({
      events: [],
    });
  }
}
