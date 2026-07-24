// src/app/api/portal/share/[action]/route.ts
//
// Consolidated dispatcher for the two portal/share sub-routes (route-count
// budget — see routeConsolidationGuard.test.ts). Preserves the exact
// pre-existing URLs: GET /api/portal/share/view and
// POST /api/portal/share/upload both resolve here with action captured as
// "view"/"upload" — no client changes needed.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireValidShareToken } from "@/lib/portal/shareAuth";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { sha256 as sha256Bytes } from "@/lib/storage/adminStorage";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/uploads/signDealUpload";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ action: string }> };

async function handleView(req: Request) {
  const { share, dealId, checklistItemIds } = await requireValidShareToken(req);
  const sb = supabaseAdmin();

  // Pull borrower-safe checklist item labels (only scoped IDs)
  const { data: items, error: iErr } = await sb
    .from("deal_portal_checklist_items")
    .select("id, title, description")
    .eq("deal_id", dealId)
    .in("id", checklistItemIds);

  if (iErr) throw iErr;

  // Deal display (best-effort; borrower-safe)
  let dealName = "Application";
  try {
    const { data: d } = await sb
      .from("deals")
      .select("id, name")
      .eq("id", dealId)
      .maybeSingle();
    if (d?.name) dealName = d.name;
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: true,
    view: {
      dealName,
      requestedItems: (items ?? []).map((x: any) => ({
        id: String(x.id),
        title: String(x.title),
        description: x.description ? String(x.description) : null,
      })),
      note: share.note ? String(share.note) : null,
      recipientName: share.recipient_name ? String(share.recipient_name) : null,
      expiresAt: String(share.expires_at),
    },
  });
}

/**
 * Counterpart to the view action — accepts one file per request from the
 * token-gated /portal/share/[token] page (a third party the banker sent a
 * scoped checklist-item share link to, e.g. an accountant). Auth is the
 * share token only (query ?token= or x-share-token header), same as view.
 */
async function handleUpload(req: Request) {
  const { dealId, checklistItemIds } = await requireValidShareToken(req);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
  }

  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ ok: false, error: `Unsupported file type: ${file.type}` }, { status: 415 });
  }
  if (typeof file.size === "number" && file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large (max 50MB)" }, { status: 413 });
  }

  const sb = supabaseAdmin();
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealErr || !deal) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }
  const bankId = String((deal as any).bank_id);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "File too large (max 50MB)" }, { status: 413 });
  }

  const safeName = (file.name || "upload").replace(/[^\w.\-()+\s]/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const random = sha256Bytes(bytes).slice(0, 12);
  const storageBucket = "deal-uploads";
  const storagePath = `deals/${dealId}/share/${ts}_${random}_${safeName}`;

  const up = await sb.storage.from(storageBucket).upload(storagePath, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json({ ok: false, error: `Upload failed: ${safeName}` }, { status: 500 });
  }

  const doc = await ingestDocument({
    dealId,
    bankId,
    file: {
      original_filename: file.name || "upload",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      storagePath,
      storageBucket,
      sha256: sha256Bytes(bytes),
    },
    source: "public",
    metadata: {
      source_detail: "portal_share_link",
      share_checklist_item_ids: checklistItemIds,
    },
  });

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "documents.upload_completed",
    uiState: "done",
    uiMessage: "Upload completed (portal share link)",
    meta: {
      storage_bucket: storageBucket,
      storage_path: storagePath,
      size_bytes: bytes.length,
      source: "portal_share_link",
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, document_id: (doc as any)?.id ?? null });
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;
    if (action !== "view") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return await handleView(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { action } = await ctx.params;
    if (action !== "upload") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return await handleUpload(req);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
