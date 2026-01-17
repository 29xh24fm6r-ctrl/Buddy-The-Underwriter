import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { reconcileChecklistForDeal } from "@/lib/checklist/engine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "edge";
export const dynamic = "force-dynamic";

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

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
    const requestId = req.headers.get("x-request-id") || null;
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized", request_id: requestId },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const body = await req.json();

    const {
      file_id,
      object_path,
      storage_path,
      storage_bucket,
      original_filename,
      mime_type,
      size_bytes,
      checklist_key = null,
      sha256,
    } = body;

    const resolvedPath = storage_path || object_path;
    const resolvedBucket =
      storage_bucket || process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";

    console.log("[UPLOAD RECORD ROUTE HIT]", {
      dealId,
      object_path: resolvedPath,
      original_filename,
      file_id,
      checklist_key,
      storage_bucket: resolvedBucket,
      requestId,
    });

    if (!file_id || !resolvedPath || !original_filename) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields", request_id: requestId },
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
        { ok: false, error: "Deal not found", request_id: requestId },
        { status: 404 },
      );
    }

    if (deal.bank_id !== bankId) {
      return NextResponse.json(
        { ok: false, error: "Deal not found", request_id: requestId },
        { status: 404 },
      );
    }

    // Verify file exists in storage (optional but recommended)
    // This MUST be best-effort and bounded; do not block the upload UX.
    let fileExists: any[] | null = null;
    let checkErr: any = null;
    try {
      if (resolvedBucket !== process.env.GCS_BUCKET) {
        const res = await withTimeout(
          sb.storage
            .from(resolvedBucket)
            .list(resolvedPath.split("/").slice(0, -1).join("/"), {
              search: resolvedPath.split("/").pop(),
            }),
          5_000,
          "storageList",
        );
        fileExists = (res as any)?.data ?? null;
        checkErr = (res as any)?.error ?? null;
      }
    } catch (e: any) {
      checkErr = e;
    }

    // Best-effort only: signed upload succeeded client-side, so we should still
    // materialize the canonical DB record even if list/search behaves oddly.
    if (checkErr) {
      console.warn("[files/record] storage check error (non-fatal)", {
        object_path: resolvedPath,
        checkErr,
      });
    } else if (resolvedBucket !== process.env.GCS_BUCKET) {
      if (!fileExists || fileExists.length === 0) {
        console.warn("[files/record] storage check did not find file (non-fatal)", {
          object_path: resolvedPath,
        });
      }
    }

    // ✅ 1) Materialize banker upload into canonical deal_documents (idempotent)
    const documentKey = `path:${resolvedPath}`.replace(/[^a-z0-9_:/-]/gi, "_");

    const doc = {
      deal_id: dealId,
      bank_id: bankId,
      original_filename,
      mime_type: mime_type ?? "application/octet-stream",
      size_bytes: size_bytes ?? 0,
      storage_bucket: resolvedBucket,
      storage_path: resolvedPath,
      sha256: sha256 ?? null,
      checklist_key: checklist_key ?? null,
      source: "internal",
      uploader_user_id: userId,
      document_key: documentKey,
      metadata: {
        ...(checklist_key ? { checklist_key } : {}),
        ...(sha256 ? { sha256 } : {}),
        committed_via: "banker_record_route",
      },
    };

    // Prefer true idempotency via unique index on (deal_id, storage_path).
    // But even if that index isn't applied yet, we still want the write path to work.
    const existing = await sb
      .from("deal_documents")
      .select("id, checklist_key")
      .eq("deal_id", dealId)
      .eq("storage_path", resolvedPath)
      .maybeSingle();

    let documentId: string | null = existing.data?.id ? String(existing.data.id) : null;

    // If we already have a record but it doesn't have checklist_key yet,
    // and the caller provided one, persist it deterministically.
    if (documentId && checklist_key && !existing.data?.checklist_key) {
      await sb
        .from("deal_documents")
        .update({ checklist_key })
        .eq("id", documentId);
    }

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
          .eq("storage_path", resolvedPath)
          .maybeSingle();

        documentId = reRead.data?.id ? String(reRead.data.id) : null;
        if (!documentId) {
          console.error("[files/record] deal_documents insert failed", ins.error);
          return NextResponse.json(
            {
              ok: false,
              error: "Failed to record document",
              details: ins.error?.message || ins.error,
              request_id: requestId,
            },
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
        storage_bucket: resolvedBucket,
        storage_path: resolvedPath,
        original_filename,
        mime_type: mime_type ?? null,
        size_bytes: size_bytes ?? null,
        sha256: sha256 ?? null,
      },
    });

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "documents.upload_completed",
      uiState: "done",
      uiMessage: `Upload completed (${resolvedBucket === process.env.GCS_BUCKET ? "gcs" : "supabase"})`,
      meta: {
        document_id: documentId,
        provider: resolvedBucket === process.env.GCS_BUCKET ? "gcs" : "supabase",
        storage_bucket: resolvedBucket,
        storage_path: resolvedPath,
        size_bytes: size_bytes ?? null,
        sha256: sha256 ?? null,
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
      meta: { document_id: documentId },
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
        request_id: req.headers.get("x-request-id") || null,
      },
      { status: 500 },
    );
  }
}
