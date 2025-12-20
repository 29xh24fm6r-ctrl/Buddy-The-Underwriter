// src/app/api/portal/owner/upload/route.ts
import { NextResponse } from "next/server";
import { requireValidOwnerPortal } from "@/lib/portal/ownerAuth";
import { applyOwnerReceiptAutoMatch } from "@/lib/checklists/ownerAutoMatch";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical:
 * - validates owner token
 * - accepts multipart (file + filename)
 * - integrates with your existing storage pipeline later
 * - records a minimal "receipt" row in a NEW table if you want; for now, we just create a synthetic receipt_id
 * - applies owner checklist auto-match using filename + hints
 */
export async function POST(req: Request) {
  try {
    const { dealId, ownerId } = await requireValidOwnerPortal(req);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const filename = String(form.get("filename") ?? file?.name ?? "upload");

    if (!file) throw new Error("Missing file.");

    // TODO integrate your real file storage + doc record creation.
    // For now, create a receipt row in deal_timeline_events (banker-only) as proof.
    const sb = supabaseAdmin();
    const receiptId = cryptoRandomId();

    await sb.from("deal_timeline_events").insert({
      deal_id: dealId,
      visibility: "banker",
      event_type: "OWNER_UPLOAD",
      title: "Owner uploaded a document",
      detail: `${filename} (ownerId=${ownerId})`,
      meta: { ownerId, filename, receiptId },
    });

    const matched = await applyOwnerReceiptAutoMatch({
      dealId,
      ownerId,
      filename,
      receiptId,
    });

    return NextResponse.json({ ok: true, receiptId, matchedItemIds: matched.matchedItemIds });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

function cryptoRandomId() {
  // lightweight uuid-ish without importing crypto in edge contexts
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
