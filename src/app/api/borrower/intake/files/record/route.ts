import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/borrower/intake/files/record
 *
 * Companion to /api/borrower/intake/files/sign — see that file's doc
 * comment for why this pair exists (no self-serve-borrower-authenticated
 * upload path existed anywhere before this).
 *
 * Deliberately a leaner insert than the staff record route
 * (/api/deals/[dealId]/files/record): that route's elaborate ignite/
 * artifact-queue/intake-state machinery is staff-workflow-specific and out
 * of scope for this fix. This writes the same core deal_documents columns
 * the staff route writes for a fresh upload, which is enough for the
 * document to appear in the deal's checklist/readiness views; deeper
 * artifact processing already runs off deal_documents via the existing
 * cron sweep regardless of which route inserted the row.
 */
export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  const session = await getBorrowerSession();
  if (!session?.deal_id) {
    return NextResponse.json(
      { ok: false, error: "no_borrower_session", request_id: requestId },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", request_id: requestId },
      { status: 400 },
    );
  }

  const {
    file_id,
    object_path,
    original_filename,
    mime_type,
    size_bytes,
    checklist_key,
  } = body;

  if (typeof object_path !== "string" || !object_path) {
    return NextResponse.json(
      { ok: false, error: "missing_object_path", request_id: requestId },
      { status: 400 },
    );
  }
  if (typeof original_filename !== "string" || !original_filename) {
    return NextResponse.json(
      { ok: false, error: "missing_original_filename", request_id: requestId },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";
  const documentKey = `path:${object_path}`.replace(/[^a-z0-9_:/-]/gi, "_");

  // Idempotent on (deal_id, storage_path) — a retried record call (e.g.
  // after a client timeout) must not create a duplicate row.
  const existing = await sb
    .from("deal_documents")
    .select("id")
    .eq("deal_id", session.deal_id)
    .eq("storage_path", object_path)
    .maybeSingle();

  let documentId: string | null = existing.data?.id ? String(existing.data.id) : null;

  if (!documentId) {
    const ins = await sb
      .from("deal_documents")
      .insert({
        deal_id: session.deal_id,
        bank_id: session.bank_id,
        original_filename,
        mime_type: typeof mime_type === "string" ? mime_type : "application/octet-stream",
        size_bytes: typeof size_bytes === "number" ? size_bytes : 0,
        storage_bucket: bucket,
        storage_path: object_path,
        checklist_key: typeof checklist_key === "string" ? checklist_key : null,
        source: "borrower_self",
        document_key: documentKey,
        metadata: { committed_via: "borrower_intake_route", file_id: typeof file_id === "string" ? file_id : null },
      } as any)
      .select("id")
      .single();

    if (ins.error || !ins.data?.id) {
      console.error("[borrower/intake/files/record] insert failed", ins.error);
      return NextResponse.json(
        { ok: false, error: "record_failed", details: ins.error?.message, request_id: requestId },
        { status: 500 },
      );
    }
    documentId = String(ins.data.id);

    try {
      await logLedgerEvent({
        dealId: session.deal_id,
        bankId: session.bank_id,
        eventKey: "document.uploaded",
        uiState: "done",
        uiMessage: `Uploaded ${original_filename}`,
        meta: { document_id: documentId, source: "borrower_self" },
      });
    } catch (e) {
      console.warn("[borrower/intake/files/record] ledger event failed (non-fatal)", e);
    }
  }

  return NextResponse.json({
    ok: true,
    file_id: typeof file_id === "string" ? file_id : documentId,
    meta: { document_id: documentId },
    checklist_key: typeof checklist_key === "string" ? checklist_key : null,
    request_id: requestId,
  });
}
