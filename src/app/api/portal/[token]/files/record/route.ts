import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { matchAndStampDealDocument, reconcileChecklistForDeal } from "@/lib/checklist/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ token: string }>;
};

/**
 * POST /api/portal/[token]/files/record
 * 
 * Borrower portal version of file metadata recorder.
 * Authorization via portal token instead of Clerk auth.
 * Otherwise identical to banker endpoint.
 * 
 * Called AFTER client uploads bytes via signed URL.
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();

    const {
      file_id,
      object_path,
      original_filename,
      mime_type,
      size_bytes,
      checklist_key = null,
    } = body;

    if (!file_id || !object_path || !original_filename) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Verify token and get deal_id
    const sb = supabaseAdmin();

    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr || !link) {
      console.error("[portal/files/record] invalid token", { token, linkErr });
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // Check expiration
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json(
        { ok: false, error: "Link expired" },
        { status: 403 },
      );
    }

    const dealId = link.deal_id;

    // Fetch deal to get bank_id (required for insert)
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      console.error("[portal/files/record] deal not found", { dealId, dealErr });
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 },
      );
    }

    // Verify file exists in storage (optional but recommended)
    const { data: fileExists, error: checkErr } = await sb.storage
      .from("deal-files")
      .list(object_path.split("/").slice(0, -1).join("/"), {
        search: object_path.split("/").pop(),
      });

    if (checkErr || !fileExists || fileExists.length === 0) {
      console.error("[portal/files/record] file not found in storage", {
        object_path,
        checkErr,
      });
      return NextResponse.json(
        { ok: false, error: "File not found in storage" },
        { status: 404 },
      );
    }

    // Insert metadata record
    const { data: inserted, error: insertErr } = await sb.from("deal_documents").insert({
      id: file_id,
      deal_id: dealId,
      bank_id: deal.bank_id, // Required: inherited from deal
      
      // Storage paths (must match table default)
      storage_bucket: "deal-files",
      storage_path: object_path,
      
      // File metadata
      original_filename,
      mime_type: mime_type ?? "application/octet-stream",
      size_bytes: size_bytes ?? 0,
      
      // Required business keys (NOT NULL columns)
      document_key: checklist_key ?? "UNCLASSIFIED",
      checklist_key: checklist_key ?? null,
      
      // Required JSON fields (NOT NULL columns)
      extracted_fields: {},
      metadata: {},
      
      // Upload tracking
      source: "borrower",
      uploader_user_id: null, // Borrower upload, no Clerk user
    }).select("*").single();

    if (insertErr || !inserted) {
      console.error("[portal/files/record] failed to insert metadata", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to record file metadata" },
        { status: 500 },
      );
    }

    // 🔥 Checklist Engine v2: stamp + reconcile
    await matchAndStampDealDocument({
      sb,
      dealId,
      documentId: inserted.id,
      originalFilename: inserted.original_filename ?? null,
      mimeType: inserted.mime_type ?? null,
      extractedFields: inserted.extracted_fields,
      metadata: inserted.metadata,
    });

    await reconcileChecklistForDeal({ sb, dealId });

    // Emit ledger event (no actorUserId for borrower uploads)
    await writeEvent({
      dealId,
      actorUserId: null,
      kind: "document.uploaded",
      input: {
        file_id,
        filename: original_filename,
        size_bytes,
        checklist_key,
        source: "borrower",
      },
    });

    // Checklist auto-resolution happens via DB trigger when checklist_key is set

    console.log("[portal/files/record] recorded borrower file", {
      dealId,
      file_id,
      filename: original_filename,
      checklist_key,
    });

    return NextResponse.json({ ok: true, file_id });
  } catch (error: any) {
    console.error("[portal/files/record]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
