import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signUploadUrl } from "@/lib/uploads/sign";
import { buildGcsObjectKey, getGcsBucketName, signGcsUploadUrl } from "@/lib/storage/gcs";
import { findExistingDocBySha } from "@/lib/storage/dedupe";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bank-grade MIME type allowlist (kept in sync with borrower portal endpoint)
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/tif",
  "image/gif",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]);

type Context = {
  params: Promise<{ token: string }>;
};

/**
 * POST /api/portal/[token]/files/sign
 * 
 * Borrower portal version of signed upload URL generator.
 * Authorization via portal token instead of Clerk auth.
 * Otherwise identical to banker endpoint.
 * 
 * Flow:
 * 1. Validate portal token
 * 2. Validate file metadata
 * 3. Return signed upload URL
 * 4. Client uploads directly to storage
 * 5. Client calls /files/record
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const { token } = await ctx.params;
    const body = await req.json();

    const {
      filename,
      mime_type,
      size_bytes,
      checklist_key = null,
      sha256,
    } = body ?? {};

    if (!filename || !size_bytes) {
      return NextResponse.json(
        { ok: false, error: "Missing filename or size_bytes" },
        { status: 400 },
      );
    }

    // MIME type enforcement (same security posture as banker endpoint)
    if (mime_type && !ALLOWED_MIME_TYPES.has(mime_type)) {
      console.warn("[portal/files/sign] rejected unsupported MIME type", {
        mime_type,
        filename,
        token,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported file type",
          details: `File type '${mime_type}' is not allowed. Supported: PDF, images, Excel, Word, text, ZIP.`,
        },
        { status: 415 },
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
      console.error("[portal/files/sign] invalid token", { token, linkErr });
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

    // Bank-safe guardrails
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB
    if (size_bytes > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File too large (max 50MB)" },
        { status: 413 },
      );
    }

    const docStore = String(process.env.DOC_STORE || "").toLowerCase();

    if (docStore === "gcs") {
      const { data: deal } = await sb
        .from("deals")
        .select("bank_id")
        .eq("id", dealId)
        .maybeSingle();

      if (!deal?.bank_id) {
        return NextResponse.json(
          { ok: false, error: "Deal not found" },
          { status: 404 },
        );
      }

      const existing = sha256
        ? await findExistingDocBySha({ sb, dealId, sha256 })
        : null;

      await logLedgerEvent({
        dealId,
        bankId: deal.bank_id,
        eventKey: "documents.sign_upload",
        uiState: "done",
        uiMessage: `Sign upload (${existing ? "dedupe" : "new"})`,
        meta: {
          filename,
          sha256: sha256 ?? null,
          deduped: Boolean(existing),
          source: "borrower_portal",
        },
      });

      if (existing?.id) {
        await logLedgerEvent({
          dealId,
          bankId: deal.bank_id,
          eventKey: "documents.upload_deduped",
          uiState: "done",
          uiMessage: "Upload deduped by sha256",
          meta: {
            existing_document_id: existing.id,
            sha256: sha256 ?? null,
            source: "borrower_portal",
          },
        });

        return NextResponse.json({
          ok: true,
          deduped: true,
          existingDocumentId: existing.id,
        });
      }

      const fileId = crypto.randomUUID();
      const objectPath = buildGcsObjectKey({
        bankId: deal.bank_id,
        dealId,
        fileId,
        filename,
      });

      const expiresSeconds = Number(process.env.GCS_SIGNED_URL_TTL_SECONDS || "900");
      const signedUploadUrl = await signGcsUploadUrl({
        key: objectPath,
        contentType: mime_type || "application/octet-stream",
        expiresSeconds,
      });

      const bucket = getGcsBucketName();
      const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();

      return NextResponse.json({
        ok: true,
        deduped: false,
        bucket,
        key: objectPath,
        signedUploadUrl,
        expiresAt,
        upload: {
          file_id: fileId,
          object_path: objectPath,
          signed_url: signedUploadUrl,
          token: null,
          checklist_key,
          bucket,
        },
      });
    }

    const fileId = crypto.randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `deals/${dealId}/${fileId}__${safeName}`;

    const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";
    const signResult = await signUploadUrl({ bucket, objectPath });

    if (!signResult.ok) {
      console.error("[portal/files/sign] failed to create signed URL", {
        requestId: signResult.requestId,
        error: signResult.error,
        detail: signResult.detail,
      });
      return NextResponse.json(
        {
          ok: false,
          requestId: signResult.requestId,
          error: signResult.error,
          details: signResult.detail,
        },
        { status: 500 },
      );
    }

    const signed = {
      signedUrl: signResult.signedUrl,
      token: signResult.token,
      path: signResult.path,
    };

    console.log("[portal/files/sign] created signed URL", {
      dealId,
      fileId,
      filename: safeName,
      size_bytes,
      token,
    });

    return NextResponse.json({
      ok: true,
      upload: {
        file_id: fileId,
        object_path: objectPath,
        signed_url: signed.signedUrl,
        token: signed.token,
        checklist_key,
      },
    });
  } catch (error: any) {
    console.error("[portal/files/sign]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
