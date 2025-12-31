import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { matchChecklistKeyFromFilename } from "@/lib/checklist/matchers";

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
      .from("deal-files")
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
      source: "internal",
      uploader_user_id: userId,
    }).select("id, checklist_key, original_filename").single();

    if (insertErr || !inserted) {
      console.error("[files/record] failed to insert metadata", insertErr);
      return NextResponse.json(
        { ok: false, error: "Failed to record file metadata" },
        { status: 500 },
      );
    }

    // 🔥 Checklist Engine v1: if no checklist_key provided, attempt filename-based match
    // NOTE: DB trigger will mark deal_checklist_items received once checklist_key is set.
    if (!inserted.checklist_key) {
      const m = matchChecklistKeyFromFilename(inserted.original_filename || "");
      if (m.matchedKey && m.confidence >= 0.6) {
        const { error: updErr } = await sb
          .from("deal_documents")
          .update({ checklist_key: m.matchedKey })
          .eq("id", inserted.id);
        
        if (!updErr) {
          // Log checklist key inference to ledger
          await sb.from("deal_pipeline_ledger").insert({
            deal_id: dealId,
            bank_id: deal.bank_id,
            stage: "doc_checklist_key_inferred",
            status: "ok",
            payload: {
              filename: inserted.original_filename,
              checklist_key: m.matchedKey,
              confidence: m.confidence,
              reason: m.reason,
              document_id: inserted.id,
            },
          });
        } else {
          console.warn("[files/record] checklist match update failed (non-fatal):", updErr);
        }
      }
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

    // 🔥 LEDGER: Log upload stage
    await sb.from("deal_pipeline_ledger").insert({
      deal_id: dealId,
      bank_id: deal.bank_id,
      stage: "upload",
      status: "ok",
      payload: {
        file_id,
        filename: original_filename,
        object_path,
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

    return NextResponse.json({
      ok: true,
      file_id,
      checklist_key: checklist_key || null,
    });
  } catch (error: any) {
    console.error("[files/record] uncaught exception", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
