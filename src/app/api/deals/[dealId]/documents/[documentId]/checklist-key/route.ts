import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  checklist_key: z.union([z.string().trim().min(1), z.null()]).optional(),
});

/**
 * PATCH /api/deals/[dealId]/documents/[documentId]/checklist-key
 *
 * Manual override to stamp deal_documents.checklist_key and trigger checklist reconcile.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; documentId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const { dealId, documentId } = await ctx.params;

  const ensured = await ensureDealBankAccess(dealId);
  if (!ensured.ok) {
    const statusCode =
      ensured.error === "deal_not_found"
        ? 404
        : ensured.error === "tenant_mismatch"
          ? 403
          : 401;
    return NextResponse.json(
      { ok: false, error: ensured.error },
      { status: statusCode, headers: { "cache-control": "no-store" } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const checklistKey = body.checklist_key ?? null;

  const sb = supabaseAdmin();

  const upd = await sb
    .from("deal_documents")
    .update({
      checklist_key: checklistKey,
      match_source: checklistKey ? "manual" : null,
      match_reason: checklistKey ? "manual_dropdown" : null,
      match_confidence: checklistKey ? 1 : null,
    } as any)
    .eq("deal_id", dealId)
    .eq("id", documentId)
    .select("id, checklist_key")
    .maybeSingle();

  if (upd.error) {
    return NextResponse.json(
      { ok: false, error: "Failed to update document", details: upd.error },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  if (!upd.data?.id) {
    return NextResponse.json(
      { ok: false, error: "Document not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  // Reconcile checklist immediately so UI reflects the attach.
  try {
    await reconcileChecklistForDeal({ sb, dealId });
  } catch (e) {
    console.error("[documents/checklist-key] reconcile failed (non-fatal)", e);
  }

  return NextResponse.json(
    { ok: true, documentId: upd.data.id, checklist_key: upd.data.checklist_key ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
