import { NextResponse } from "next/server";

import { ingestDocument } from "@/lib/documents/ingestDocument";
import { logLedgerEventRequired } from "@/lib/pipeline/logLedgerEvent";
import { requireValidShareToken, ShareTokenError } from "@/lib/portal/shareAuth";
import { documentUploadBucket, uploadDocumentBytes } from "@/lib/storage/documentBytes";
import { sha256 as sha256Bytes } from "@/lib/storage/adminStorage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/uploads/signDealUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store, private, max-age=0" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function safeFilename(value: unknown): string {
  const original = String(value || "").trim();
  if (!original || original.length > 180 || /[\u0000-\u001f\u007f]/.test(original)) {
    throw new Error("invalid_filename");
  }
  const safe = original.replace(/[^\w.\-()+\s]/g, "_").replace(/\s+/g, " ").slice(0, 180);
  if (!safe || safe === "." || safe === "..") throw new Error("invalid_filename");
  return safe;
}

async function handleView(req: Request) {
  const { share, dealId, checklistItemIds } = await requireValidShareToken(req);
  const sb = supabaseAdmin();
  const { data: items, error: itemError } = await sb
    .from("deal_portal_checklist_items")
    .select("id, title, description")
    .eq("deal_id", dealId)
    .in("id", checklistItemIds);
  if (itemError) return json({ ok: false, error: "share_view_unavailable" }, 503);

  const returned = new Set((items ?? []).map((item: any) => String(item.id)));
  if (returned.size !== checklistItemIds.length || checklistItemIds.some((id) => !returned.has(id))) {
    return json({ ok: false, error: "share_scope_unavailable" }, 503);
  }

  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select("id, name")
    .eq("id", dealId)
    .maybeSingle();
  if (dealError) return json({ ok: false, error: "share_view_unavailable" }, 503);
  if (!deal || String((deal as any).id) !== dealId) {
    return json({ ok: false, error: "share_unavailable" }, 410);
  }

  const titleById = new Map((items ?? []).map((item: any) => [String(item.id), item]));
  return json({
    ok: true,
    view: {
      dealName: String((deal as any).name || "Application").slice(0, 200),
      requestedItems: checklistItemIds.map((id) => {
        const item: any = titleById.get(id);
        return {
          id,
          title: String(item.title || "Requested document").slice(0, 200),
          description: item.description ? String(item.description).slice(0, 2_000) : null,
        };
      }),
      note: share.note ? String(share.note).slice(0, 2_000) : null,
      recipientName: share.recipient_name ? String(share.recipient_name).slice(0, 128) : null,
      expiresAt: share.expires_at,
    },
  });
}

async function handleUpload(req: Request) {
  const { dealId, checklistItemIds } = await requireValidShareToken(req);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ ok: false, error: "invalid_upload" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, error: "missing_file" }, 400);
  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
    return json({ ok: false, error: "unsupported_file_type" }, 415);
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return json({ ok: false, error: "empty_file" }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, error: "file_too_large" }, 413);

  let safeName: string;
  try {
    safeName = safeFilename(file.name);
  } catch {
    return json({ ok: false, error: "invalid_filename" }, 400);
  }

  const sb = supabaseAdmin();
  const { data: deal, error: dealError } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealError) return json({ ok: false, error: "upload_unavailable" }, 503);
  const bankId = String((deal as any)?.bank_id || "");
  if (!deal || String((deal as any).id) !== dealId || !UUID_RE.test(bankId)) {
    return json({ ok: false, error: "share_unavailable" }, 410);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || bytes.length <= 0) {
    return json({ ok: false, error: "upload_size_mismatch" }, 400);
  }
  if (bytes.length > MAX_UPLOAD_BYTES) return json({ ok: false, error: "file_too_large" }, 413);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const digest = sha256Bytes(bytes);
  const storageBucket = documentUploadBucket();
  const storagePath = `deals/${dealId}/share/${ts}_${digest.slice(0, 12)}_${safeName}`;

  try {
    await uploadDocumentBytes({
      bucket: storageBucket,
      path: storagePath,
      bytes,
      contentType: file.type,
      upsert: false,
    });
  } catch {
    console.error("[portal/share/upload] storage_write_failed", { phase: "storage" });
    return json({ ok: false, error: "upload_unavailable", retryable: true }, 503);
  }

  let documentId: string;
  try {
    const ingested = await ingestDocument({
      dealId,
      bankId,
      file: {
        original_filename: file.name,
        mimeType: file.type,
        sizeBytes: bytes.length,
        storagePath,
        storageBucket,
        sha256: digest,
      },
      source: "public",
      metadata: {
        source_detail: "portal_share_link",
        share_checklist_item_ids: checklistItemIds,
      },
    });
    documentId = String(ingested?.documentId || "");
    if (!UUID_RE.test(documentId)) throw new Error("unproven_document");
  } catch {
    console.error("[portal/share/upload] document_persistence_incomplete", { phase: "document" });
    return json(
      { ok: false, error: "upload_reconciliation_required", retryable: false },
      503,
    );
  }

  const ledger = await logLedgerEventRequired({
    dealId,
    bankId,
    eventKey: "documents.upload_completed",
    uiState: "done",
    uiMessage: "Upload completed (portal share link)",
    meta: { document_id: documentId, size_bytes: bytes.length, source: "portal_share_link" },
  });
  if (!ledger.ok) {
    console.error("[portal/share/upload] completion_evidence_incomplete", { phase: "ledger" });
    return json(
      { ok: false, error: "upload_reconciliation_required", retryable: false },
      503,
    );
  }

  return json({ ok: true, document_id: documentId }, 201);
}

function routeError(error: unknown) {
  if (error instanceof ShareTokenError) return json({ ok: false, error: error.publicCode }, error.status);
  console.error("[portal/share] request_failed", { error: "bounded_internal_failure" });
  return json({ ok: false, error: "request_unavailable" }, 503);
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;
    if (action !== "view") return json({ ok: false, error: "not_found" }, 404);
    return await handleView(req);
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;
    if (action !== "upload") return json({ ok: false, error: "not_found" }, 404);
    return await handleUpload(req);
  } catch (error) {
    return routeError(error);
  }
}
