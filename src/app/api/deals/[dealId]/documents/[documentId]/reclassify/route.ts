import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string; documentId: string }>;

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

    if (!body.canonical_doc_type) {
      return NextResponse.json({ ok: false, error: "canonical_doc_type is required" }, { status: 400 });
    }

    // Update the source document classification
    await sb
      .from("deal_documents")
      .update({
        ai_doc_type: body.canonical_doc_type,
      })
      .eq("id", documentId)
      .eq("deal_id", dealId);

    // Update ledger
    await sb
      .from("deal_document_items")
      .update({
        canonical_doc_type: body.canonical_doc_type,
        classified_type: body.canonical_doc_type,
        classified_at: new Date().toISOString(),
        review_status: "unreviewed",
        validation_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .eq("document_id", documentId);

    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: userId,
      event: "document_reclassified",
      payload: {
        document_id: documentId,
        new_type: body.canonical_doc_type,
        reason: body.reason ?? null,
      },
    }).then(null, () => {});

    await recomputeDealDocumentState(dealId);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
