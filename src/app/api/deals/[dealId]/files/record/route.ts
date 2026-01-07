import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

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
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const body = await req.json();

    const {
      file_id,
      object_path,
      original_filename,
      mime_type,
      size_bytes,
      checklist_key = null,
    } = body;

    console.log("[UPLOAD RECORD ROUTE HIT]", {
      dealId,
      object_path,
      original_filename,
      file_id,
      checklist_key,
    });

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

    if (deal.bank_id !== bankId) {
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

    // ✅ 1) Materialize banker upload into canonical deal_documents (idempotent)
    const documentKey = `path:${object_path}`.replace(/[^a-z0-9_:/-]/gi, "_");

    const doc = {
      deal_id: dealId,
      bank_id: bankId,
      original_filename,
      mime_type: mime_type ?? "application/octet-stream",
      size_bytes: size_bytes ?? 0,
      storage_path: object_path,
      source: "internal",
      uploader_user_id: userId,
      document_key: documentKey,
      metadata: {
        ...(checklist_key ? { checklist_key } : {}),
        committed_via: "banker_record_route",
      },
    };

    // Prefer true idempotency via unique index on (deal_id, storage_path).
    // But even if that index isn't applied yet, we still want the write path to work.
    const existing = await sb
      .from("deal_documents")
      .select("id")
      .eq("deal_id", dealId)
      .eq("storage_path", object_path)
      .maybeSingle();

    let documentId: string | null = existing.data?.id ? String(existing.data.id) : null;

    if (!documentId) {
      const ins = await sb
        .from("deal_documents")
        .insert(doc as any)
        .select("id")
        .single();

      if (ins.error || !ins.data?.id) {
        // If the DB now has a unique constraint and we raced, try read-after-write.
        const reRead = await sb
          .from("deal_documents")
          .select("id")
          .eq("deal_id", dealId)
          .eq("storage_path", object_path)
          .maybeSingle();

        documentId = reRead.data?.id ? String(reRead.data.id) : null;
        if (!documentId) {
          console.error("[files/record] deal_documents insert failed", ins.error);
          return NextResponse.json(
            { ok: false, error: "Failed to record document" },
            { status: 500 },
          );
        }
      } else {
        documentId = String(ins.data.id);
      }
    }

    // ✅ 2) Reconcile checklist immediately (THIS flips received/pending)
    await reconcileChecklistForDeal({ sb, dealId });

    // ✅ 3) Pipeline ledger audit trail
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "upload_commit",
      uiState: "done",
      uiMessage: `Banker upload committed: ${original_filename}`,
      meta: {
        document_id: documentId,
        storage_path: object_path,
        original_filename,
        mime_type: mime_type ?? null,
        size_bytes: size_bytes ?? null,
      },
    });

    // 🧠 CONVERGENCE: Recompute deal readiness
    await recomputeDealReady(dealId);

    // Emit ledger event (legacy - can be removed after ledger consolidation)
    await writeEvent({
      dealId,
      actorUserId: userId,
      kind: "document.uploaded",
      input: {
        file_id,
        original_filename,
        size_bytes,
        checklist_key,
      },
    });

    console.log("[files/record] recorded file", {
      dealId,
      file_id,
      original_filename,
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
        error: error?.message || "Internal server error",
        details: error.message || String(error),
      },
      { status: 500 },
    );
  }
}
