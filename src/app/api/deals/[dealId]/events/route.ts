import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type { AuditLedgerRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * GET /api/deals/[dealId]/events
 * 
 * Returns recent deal events for activity feed.
 * Primary source: audit_ledger (canonical event ledger)
 * Fallback: deal_documents (if audit_ledger table doesn't exist)
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { dealId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const sb = supabaseAdmin();

    // Try to fetch from audit_ledger first (canonical source)
    const { data: auditEvents, error: auditError } = await sb
      .from("audit_ledger")
      .select("id, deal_id, actor_user_id, scope, action, kind, input_json, output_json, confidence, evidence_json, requires_human_review, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Check if error indicates audit_ledger table doesn't exist
    if (auditError) {
      const errorMessage = auditError.message || "";
      const isTableMissing = errorMessage.includes("audit_ledger") && 
                           (errorMessage.includes("does not exist") || errorMessage.includes("relation"));

      if (isTableMissing) {
        // Fallback to deal_documents
        const { data: documents, error: docsError } = await sb
          .from("deal_documents")
          .select("id, original_filename, doc_type, created_at")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (docsError) {
          console.error("[/api/deals/[dealId]/events]", docsError);
          return NextResponse.json({
            ok: false,
            events: [],
            error: "Failed to load events",
          });
        }

        // Transform documents into event format
        const fallbackEvents = (documents || []).map((doc) => ({
          id: doc.id,
          kind: "document_uploaded",
          metadata: {
            filename: doc.original_filename,
            doc_type: doc.doc_type,
          },
          created_at: doc.created_at,
        }));

        return NextResponse.json({
          ok: true,
          events: fallbackEvents,
          source: "deal_documents_fallback",
        });
      }

      // Other error (not table missing)
      console.error("[/api/deals/[dealId]/events]", auditError);
      return NextResponse.json({
        ok: false,
        events: [],
        error: "Failed to load events",
      });
    }

    // Successfully retrieved from audit_ledger
    return NextResponse.json({
      ok: true,
      events: auditEvents || [],
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/events]", error);
    return NextResponse.json({
      ok: false,
      events: [],
      error: "Failed to load events",
    });
  }
}
