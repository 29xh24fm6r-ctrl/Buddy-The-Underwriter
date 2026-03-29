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

    const { error } = await sb
      .from("deal_document_items")
      .update({
        review_status: "rejected",
        validation_status: "invalid",
        checklist_status: "missing",
        readiness_status: "blocking",
        updated_at: new Date().toISOString(),
      })
      .eq("deal_id", dealId)
      .eq("document_id", documentId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: userId,
      event: "document_rejected",
      payload: { document_id: documentId, reason: body.reason ?? null, note: body.note ?? null },
    }).then(null, () => {});

    await recomputeDealDocumentState(dealId);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
