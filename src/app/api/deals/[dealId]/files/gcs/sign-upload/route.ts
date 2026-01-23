import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { buildGcsObjectKey, getGcsBucketName, signGcsUploadUrl } from "@/lib/storage/gcs";
import { findExistingDocBySha } from "@/lib/storage/dedupe";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import crypto from "node:crypto";
import { buildGcsSignedUploadResponse } from "@/lib/storage/gcsUploadResponse";
import {
  createDealUploadSession,
  upsertUploadSessionFile,
  validateUploadSession,
} from "@/lib/uploads/uploadSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bank-grade MIME type allowlist (aligned with /files/sign)
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
  params: Promise<{ dealId: string }>;
};

export async function POST(req: NextRequest, ctx: Context) {
  try {
    if (String(process.env.DOC_STORE || "").toLowerCase() !== "gcs") {
      return NextResponse.json(
        { ok: false, error: "DOC_STORE is not gcs" },
        { status: 400 },
      );
    }

    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const body = await req.json();

    const {
      filename,
      contentType,
      sizeBytes,
      sha256,
      upload_session_id,
      session_id,
    } = body ?? {};

    if (!filename || !contentType || !sizeBytes) {
      return NextResponse.json(
        { ok: false, error: "Missing filename, contentType, or sizeBytes" },
        { status: 400 },
      );
    }

    if (contentType && !ALLOWED_MIME_TYPES.has(contentType)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported file type",
          details: `File type '${contentType}' is not allowed. Supported: PDF, images, Excel, Word, text, ZIP.`,
        },
        { status: 415 },
      );
    }

    const MAX_BYTES = 50 * 1024 * 1024;
    if (Number(sizeBytes) > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File too large (max 50MB)" },
        { status: 413 },
      );
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();
    const headerSessionId = req.headers.get("x-buddy-upload-session-id");
    let uploadSessionId = headerSessionId || upload_session_id || session_id || null;
    let uploadSessionExpiresAt: string | null = null;

    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found or access denied" },
        { status: 403 },
      );
    }

    const existing = sha256
      ? await findExistingDocBySha({ sb, dealId, sha256 })
      : null;

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "documents.sign_upload",
      uiState: "done",
      uiMessage: `Sign upload (${existing ? "dedupe" : "new"})`,
      meta: {
        filename,
        sha256: sha256 ?? null,
        deduped: Boolean(existing),
      },
    });

    if (existing?.id) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "documents.upload_deduped",
        uiState: "done",
        uiMessage: "Upload deduped by sha256",
        meta: {
          existing_document_id: existing.id,
          sha256: sha256 ?? null,
        },
      });

      return NextResponse.json({
        ok: true,
        deduped: true,
        existingDocumentId: existing.id,
      });
    }

    if (uploadSessionId) {
      const validation = await validateUploadSession({
        sb,
        sessionId: uploadSessionId,
        dealId,
        bankId,
      });
      if (!validation.ok) {
        return NextResponse.json(
          { ok: false, error: validation.error },
          { status: 409 },
        );
      }
    } else {
      const created = await createDealUploadSession({
        sb,
        dealId,
        bankId,
        source: "banker",
        createdByUserId: userId,
      });
      uploadSessionId = created.sessionId;
      uploadSessionExpiresAt = created.expiresAt;
    }

    const fileId = crypto.randomUUID();
    const objectPath = buildGcsObjectKey({
      bankId,
      dealId,
      fileId,
      filename,
      uploadSessionId,
    });

    const expiresSeconds = Number(process.env.GCS_SIGNED_URL_TTL_SECONDS || "900");
    const signedUploadUrl = await signGcsUploadUrl({
      key: objectPath,
      contentType,
      expiresSeconds,
    });

    const bucket = getGcsBucketName();
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();

    if (uploadSessionId) {
      await upsertUploadSessionFile({
        sb,
        sessionId: uploadSessionId,
        dealId,
        bankId,
        fileId,
        filename,
        contentType,
        sizeBytes,
        objectKey: objectPath,
        bucket,
      });
    }

    return NextResponse.json(
      buildGcsSignedUploadResponse({
        bucket,
        key: objectPath,
        signedUploadUrl,
        expiresSeconds,
        uploadSessionId,
        uploadSessionExpiresAt,
      }),
    );
  } catch (error: any) {
    console.error("[gcs/sign-upload]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
