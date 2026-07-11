import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Phase 15 — Attach Document to Slot
// ---------------------------------------------------------------------------

export type AttachToSlotParams = {
  dealId: string;
  bankId: string;
  slotId: string;
  documentId: string;
  attachedByRole: "banker" | "borrower" | "system";
  userId?: string;
};

export type AttachToSlotResult = {
  ok: boolean;
  attachmentId?: string;
  error?: string;
};

/**
 * Attach a document to a slot (idempotent, with replacement).
 *
 * 1. Validate slot belongs to deal
 * 2. Deactivate prior active attachment for this slot
 * 3. Insert new active attachment
 * 4. Update slot status to 'attached'
 * 5. Stamp deal_documents.slot_id
 */
export async function attachDocumentToSlot(
  params: AttachToSlotParams,
): Promise<AttachToSlotResult> {
  const { dealId, bankId, slotId, documentId, attachedByRole, userId } = params;
  const sb = supabaseAdmin();

  // 1. Validate slot belongs to this deal
  const { data: slot, error: slotErr } = await sb
    .from("deal_document_slots")
    .select("id, deal_id, status")
    .eq("id", slotId)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (slotErr || !slot) {
    return {
      ok: false,
      error: slotErr?.message ?? "Slot not found or does not belong to this deal",
    };
  }

  // Phase U: Reject attachment on validated/completed slots (immutable)
  const slotStatus = (slot as any).status;
  if (slotStatus === "validated" || slotStatus === "completed") {
    return {
      ok: false,
      error: `slot_immutable_${slotStatus}`,
    };
  }

  // 2. Deactivate prior active attachments for this slot
  await sb
    .from("deal_document_slot_attachments")
    .update({ is_active: false } as any)
    .eq("slot_id", slotId)
    .eq("is_active", true);

  // 2b. Deactivate any OTHER active attachment for this document, regardless
  // of which slot it currently lives on. Without this, a document can end up
  // active on two slots at once (e.g. a manual re-attach or auto-match that
  // doesn't first release the document's prior slot). This runs for every
  // caller of attachDocumentToSlot — callers must not have to remember to
  // release the old slot themselves.
  const { data: releasedOtherAttachments } = await sb
    .from("deal_document_slot_attachments")
    .update({ is_active: false } as any)
    .eq("document_id", documentId)
    .neq("slot_id", slotId)
    .eq("is_active", true)
    .select("slot_id");

  // Reset status on any slot(s) this document was just moved off of, so they
  // don't keep showing "attached" for a document that no longer lives there.
  const releasedOtherSlotIds = [
    ...new Set((releasedOtherAttachments ?? []).map((r: any) => r.slot_id as string)),
  ];
  if (releasedOtherSlotIds.length > 0) {
    await sb
      .from("deal_document_slots")
      .update({ status: "empty", validation_reason: null } as any)
      .in("id", releasedOtherSlotIds);
  }

  // 3. Insert new active attachment
  const { data: attachment, error: insertErr } = await sb
    .from("deal_document_slot_attachments")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      slot_id: slotId,
      document_id: documentId,
      attached_by_role: attachedByRole,
      attached_by_user_id: userId ?? null,
      is_active: true,
    } as any)
    .select("id")
    .single();

  if (insertErr || !attachment) {
    return {
      ok: false,
      error: insertErr?.message ?? "Failed to create slot attachment",
    };
  }

  // Update replaced_by_id on prior attachments (best effort)
  await sb
    .from("deal_document_slot_attachments")
    .update({ replaced_by_id: attachment.id } as any)
    .eq("slot_id", slotId)
    .eq("is_active", false)
    .is("replaced_by_id", null);

  // 4. Update slot status to 'attached'
  await sb
    .from("deal_document_slots")
    .update({
      status: "attached",
      validation_reason: null,
    } as any)
    .eq("id", slotId);

  // 5. Stamp deal_documents.slot_id for fast lookup in processArtifact
  await sb
    .from("deal_documents")
    .update({ slot_id: slotId } as any)
    .eq("id", documentId);

  console.log("[attachDocumentToSlot] attached", {
    dealId,
    slotId,
    documentId,
    attachmentId: attachment.id,
  });

  return { ok: true, attachmentId: attachment.id };
}
