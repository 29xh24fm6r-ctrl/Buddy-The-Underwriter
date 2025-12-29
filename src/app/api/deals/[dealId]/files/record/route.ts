import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * POST /api/deals/[dealId]/files/record
 * 
 * Records file metadata after successful direct upload to storage.
 * Called AFTER client uploads bytes via signed URL.
 * 
 * Flow:
 * 1. Client uploads file to signed URL from /files/sign
 * 2. Client calls this endpoint with metadata
 * 3. We insert record into deal_documents table
 * 4. Emit ledger event (document.uploaded)
 * 5. Trigger checklist auto-resolution (if checklist_key provided)
 * 
 * This endpoint handles METADATA ONLY, never file bytes.
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;
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

    // Verify deal exists (authorization already happened at /files/sign)
    const sb = supabaseAdmin();

    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      console.error("[files/record] deal not found", { dealId, dealErr });
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 },
      );
    }

    // Verify file exists in storage (optional but recommended)
    const { data: fileExists, error: checkErr } = await sb.storage
      .from("deal-documents")
      .list(object_path.split("/").slice(0, -1).join("/"), {
        search: object_path.split("/").pop(),
      });

    if (checkErr || !fileExists || fileExists.length === 0) {
      console.error("[files/record] file not found in storage", {
        object_path,
        checkErr,
      });
      return NextResponse.json(
        { ok: false, error: "File not found in storage" },
        { status: 404 },
      );
    }

    // Insert metadata record
    const { error: insertErr } = await sb.from("deal_documents").insert({
      id: file_id,
      deal_id: dealId,
      bank_id: deal.bank_id, // Required: inherited from deal
      storage_bucket: "deal-documents",
      storage_path: object_path,
      original_filename,
      mime_type: mime_type || "application/octet-stream",
      size_bytes: size_bytes || 0,
      uploader_user_id: userId,
      source: "internal",
      checklist_key,
    });

    if (insertErr) {
      console.error("[files/record] failed to insert metadata", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to record file metadata" },
        { status: 500 },
      );
    }

    // Emit ledger event
    await writeEvent({
      dealId,
      actorUserId: userId,
      kind: "document.uploaded",
      input: {
        file_id,
        filename: original_filename,
        size_bytes,
        checklist_key,
      },
    });

    // Checklist auto-resolution happens via DB trigger when checklist_key is set
    // No additional code needed here

    console.log("[files/record] recorded file", {
      dealId,
      file_id,
      filename: original_filename,
      checklist_key,
    });

    return NextResponse.json({ ok: true, file_id });
  } catch (error: any) {
    console.error("[files/record]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
