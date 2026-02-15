import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// GET /api/deals/:dealId/slots — List all slots with active attachments
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  ctx: RouteContext,
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  if (!dealId) {
    return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
  }

  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch all slots for this deal
  const { data: slots, error: slotsErr } = await (sb as any)
    .from("deal_document_slots")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("sort_order", { ascending: true });

  if (slotsErr) {
    return NextResponse.json(
      { ok: false, error: slotsErr.message },
      { status: 500 },
    );
  }

  if (!slots || slots.length === 0) {
    return NextResponse.json({ ok: true, slots: [] });
  }

  // Fetch active attachments for all slots in one query
  const slotIds = slots.map((s: any) => s.id);
  const { data: attachments } = await (sb as any)
    .from("deal_document_slot_attachments")
    .select("id, slot_id, document_id, attached_by_role, created_at")
    .in("slot_id", slotIds)
    .eq("is_active", true);

  // Fetch document metadata for attached docs
  const docIds = (attachments ?? []).map((a: any) => a.document_id);
  let docsMap: Record<string, any> = {};
  if (docIds.length > 0) {
    const { data: docs } = await sb
      .from("deal_documents")
      .select(
        "id, original_filename, display_name, document_type, canonical_type, " +
        "ai_confidence, ai_doc_type, ai_tax_year, artifact_status, checklist_key, finalized_at, " +
        "gatekeeper_route, gatekeeper_doc_type, gatekeeper_needs_review, gatekeeper_tax_year",
      )
      .in("id", docIds);

    for (const doc of (docs ?? []) as any[]) {
      docsMap[doc.id] = doc;
    }
  }

  // Build attachment index by slot_id
  const attachmentBySlot: Record<string, any> = {};
  for (const att of attachments ?? []) {
    attachmentBySlot[att.slot_id] = {
      attachment_id: att.id,
      document_id: att.document_id,
      attached_by_role: att.attached_by_role,
      attached_at: att.created_at,
      document: docsMap[att.document_id] ?? null,
    };
  }

  // Merge slots with attachment data
  const enriched = slots.map((slot: any) => ({
    ...slot,
    attachment: attachmentBySlot[slot.id] ?? null,
  }));

  return NextResponse.json({ ok: true, slots: enriched });
}

// ---------------------------------------------------------------------------
// POST /api/deals/:dealId/slots — Attach existing document to a slot
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  ctx: RouteContext,
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  if (!dealId) {
    return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });
  }

  const bankId = await getCurrentBankId();
  const body = await req.json();

  const { slot_id, document_id } = body;
  if (!slot_id || !document_id) {
    return NextResponse.json(
      { ok: false, error: "slot_id and document_id are required" },
      { status: 400 },
    );
  }

  const { attachDocumentToSlot } = await import(
    "@/lib/intake/slots/attachDocumentToSlot"
  );

  const result = await attachDocumentToSlot({
    dealId,
    bankId,
    slotId: slot_id,
    documentId: document_id,
    attachedByRole: "banker",
    userId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 },
    );
  }

  // Re-queue artifact for re-validation with slot context
  try {
    const { queueArtifact } = await import("@/lib/artifacts/queueArtifact");
    await queueArtifact({
      dealId,
      bankId,
      sourceTable: "deal_documents",
      sourceId: document_id,
    });
  } catch {
    // Non-fatal: artifact may already be processed
  }

  return NextResponse.json({
    ok: true,
    attachment_id: result.attachmentId,
  });
}
