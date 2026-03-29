import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string; documentId: string }>;

/**
 * POST /api/deals/[dealId]/documents/[documentId]/confirm
 * Confirms a document match. Triggers recompute.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId, documentId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const sb = supabaseAdmin();
    const body = await req.json().catch(() => ({}));

    // Update ledger item
    const { error } = await sb
      .from("deal_document_items")
      .update({
        review_status: "confirmed",
        validation_status: "valid",
        checklist_status: "satisfied",
        readiness_status: "complete",
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .eq("document_id", documentId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // Audit
    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: userId,
      event: "document_confirmed",
      payload: { document_id: documentId, note: body.note ?? null },
    }).then(null, () => {});

    // Recompute
    await recomputeDealDocumentState(dealId);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
