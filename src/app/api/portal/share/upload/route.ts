// src/app/api/portal/share/upload/route.ts
import { NextResponse } from "next/server";
import { requireValidShareToken } from "@/lib/portal/shareAuth";
import { recordReceipt } from "@/lib/portal/receipts";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * IMPORTANT:
 * This is a thin wrapper. You should integrate with your existing file upload/storage path.
 * Canonical:
 * - validates share token
 * - only allows uploads for scoped checklist items
 * - records receipt (borrower-safe) + checklist auto-highlight
 */
export async function POST(req: Request) {
  try {
    const { token, dealId, checklistItemIds } = await requireValidShareToken(req);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const filename = String(form.get("filename") ?? file?.name ?? "upload");

    if (!file) throw new Error("Missing file.");

    // TODO: integrate your actual upload pipeline here.
    // For now: we only record a receipt + mark checklist from filename match.
    // If you already have an upload storage route, call it internally (server-side), then pass fileId.
    const fileId: string | null = null;

    // Record receipt with metadata indicating share token path (server-only meta)
    const receiptRes = await recordReceipt({
      dealId,
      uploaderRole: "borrower",
      filename,
      fileId,
      meta: {
        source: "portal_share_link",
        shareToken: token,
        scopedChecklistItemIds: checklistItemIds,
      },
    });

    // Optional: also create a banker-only timeline event that a third party uploaded
    const sb = supabaseAdmin();
    await sb.from("deal_timeline_events").insert({
      deal_id: dealId,
      visibility: "banker",
      event_type: "THIRD_PARTY_UPLOAD",
      title: "Third-party uploaded a document",
      detail: filename,
      meta: { shareToken: token, checklistUpdated: receiptRes.checklistUpdated },
    });

    return NextResponse.json({ ok: true, receiptId: receiptRes.receipt.id, checklistUpdated: receiptRes.checklistUpdated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
