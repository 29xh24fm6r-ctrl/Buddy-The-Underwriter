import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { recordBorrowerUploadAndMaterialize } from "@/lib/uploads/recordBorrowerUploadAndMaterialize";
import { recordReceipt } from "@/lib/portal/receipts";

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

    console.log("[UPLOAD RECORD ROUTE HIT - PORTAL]", {
      token,
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

    // Canonical ingestion: insert doc + stamp checklist + reconcile + log ledger
    const result = await ingestDocument({
      dealId,
      bankId: deal.bank_id,
      file: {
        original_filename,
        mimeType: mime_type ?? "application/octet-stream",
        sizeBytes: size_bytes ?? 0,
        storagePath: object_path,
      },
      source: "borrower_portal",
      metadata: { checklist_key },
    });

    // Borrower-safe receipt + portal checklist highlight (hint-based)
    // This is intentionally separate from canonical checklist reconciliation.
    await recordReceipt({
      dealId,
      uploaderRole: "borrower",
      filename: original_filename,
      fileId: result.documentId,
      meta: {
        source: "borrower_portal",
        storage_path: object_path,
        checklist_key: checklist_key ?? null,
      },
    });

    // ✅ Audit trail: record borrower_uploads row for this upload (idempotent)
    await recordBorrowerUploadAndMaterialize({
      dealId,
      bankId: deal.bank_id,
      requestId: null,
      storageBucket: "deal-files",
      storagePath: object_path,
      originalFilename: original_filename,
      mimeType: mime_type ?? "application/octet-stream",
      sizeBytes: size_bytes ?? 0,
      source: "borrower_portal",
      // This route already materializes via ingestDocument.
      materialize: false,
    });

    // 🧠 CONVERGENCE: Recompute deal readiness
    await recomputeDealReady(dealId);

    // Emit ledger event (legacy - no actorUserId for borrower uploads)
    await writeEvent({
      dealId,
      actorUserId: null,
      kind: "document.uploaded",
      input: {
        file_id,
        original_filename,
        size_bytes,
        checklist_key,
        source: "borrower",
      },
    });

    console.log("[portal/files/record] recorded borrower file", {
      dealId,
      file_id,
      original_filename,
      checklist_key,
    });

    return NextResponse.json({ ok: true, file_id, ...result });
  } catch (error: any) {
    console.error("[portal/files/record] uncaught exception", {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
