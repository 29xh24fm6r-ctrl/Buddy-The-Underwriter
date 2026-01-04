import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/uploads/status
 * 
 * Returns upload processing status for UX state management.
 * Used by progress bar and auto-seed button readiness.
 * 
 * Contract:
 * - status: "processing" | "blocked" | "ready"
 * - total: total documents uploaded
 * - processed: documents successfully committed
 * - remaining: documents still processing
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Get all documents for this deal
    const { data: docs, error: docsErr } = await sb
      .from("deal_documents")
      .select("id, document_key, metadata")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId);

    if (docsErr) throw docsErr;

    const total = docs?.length || 0;
    const processed = docs?.filter((d) => d.document_key).length || 0;
    const remaining = total - processed;

    // Check if uploads_completed event was emitted
    const { data: completedEvent } = await sb
      .from("deal_pipeline_ledger")
      .select("created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("event_key", "uploads_completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Determine status
    let status: "processing" | "blocked" | "ready";
    if (completedEvent) {
      status = "ready";
    } else if (remaining > 0) {
      status = "blocked";
    } else if (total === 0) {
      status = "ready"; // No uploads yet, ready for initial seed
    } else {
      status = "ready"; // All processed
    }

    return NextResponse.json({
      ok: true,
      status,
      total,
      processed,
      remaining,
      documents: docs?.map((d) => ({
        id: d.id,
        document_key: d.document_key || "processing",
        matched: !!(d.metadata as any)?.checklist_key,
      })) || [],
    });
  } catch (error: any) {
    console.error("[uploads/status] Error:", error);
    return NextResponse.json({
      ok: true,
      status: "ready" as const,
      total: 0,
      processed: 0,
      remaining: 0,
      documents: [],
    });
  }
}
