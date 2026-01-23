import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { findExistingDocBySha } from "@/lib/storage/dedupe";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  signDealUpload,
} from "@/lib/uploads/signDealUpload";
import {
  createDealUploadSession,
  upsertUploadSessionFile,
  validateUploadSession,
} from "@/lib/uploads/uploadSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function randomUUID() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    Promise.resolve(p),
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms)
    ),
  ]);
}

async function checkDealAccessWithRetries(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  bankId: string;
  maxAttempts?: number;
}) {
  const maxAttempts = args.maxAttempts ?? 3;
  let lastError: any = null;
  let deal: { id: string; bank_id?: string | null } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await withTimeout(
      args.sb
        .from("deals")
        .select("id, bank_id")
        .eq("id", args.dealId)
        .maybeSingle(),
      8_000,
      "checkDealAccess",
    );

    deal = (res?.data ?? null) as any;
    lastError = res?.error ?? null;

    if (deal?.id) return { deal, error: null };
    if (lastError) break;
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  return { deal: null, error: lastError };
}

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * POST /api/deals/[dealId]/files/sign
 * 
 * Returns a signed upload URL for direct-to-storage upload.
 * NO FILE BYTES PASS THROUGH THIS ENDPOINT.
 * 
 * Flow:
 * 1. Validate user authorization
 * 2. Validate file metadata (size, type)
 * 3. Generate signed PUT URL from Supabase Storage
 * 4. Return URL to client
 * 5. Client uploads directly to storage
 * 6. Client calls /files/record to register metadata
 * 
 * This works with Vercel protection ON because storage is external.
 */
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const requestId = req.headers.get("x-request-id") || `sign_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const { userId } = await withTimeout(clerkAuth(), 8_000, "clerkAuth");
    if (!userId) {
      console.warn("[files/sign] unauthorized", {
        clerkConfigured: isClerkConfigured(),
        hasCookie: Boolean(req.headers.get("cookie")),
        host: req.headers.get("host"),
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
        userAgent: req.headers.get("user-agent"),
      });
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "Unauthorized",
          details:
            "No Clerk session on this request. Ensure you are signed in on this host and retry. If using a forwarded port domain (e.g. *.app.github.dev), ensure it is allowed in Clerk settings.",
        },
        { status: 401 },
      );
    }

    const { dealId } = await ctx.params;
    const body = await req.json();

    const {
      filename,
      mime_type,
      size_bytes,
      checklist_key = null,
      sha256,
      upload_session_id,
      session_id,
    } = body ?? {};

    if (!filename || !size_bytes) {
      return NextResponse.json(
        { ok: false, requestId, error: "Missing filename or size_bytes" },
        { status: 400 },
      );
    }

    // MIME type enforcement (bank-grade security)
    if (mime_type && !ALLOWED_MIME_TYPES.has(mime_type)) {
      console.warn("[files/sign] rejected unsupported MIME type", {
        mime_type,
        filename,
        dealId,
      });
      return NextResponse.json(
        {
          ok: false,
          requestId,
          error: "Unsupported file type",
          details: `File type '${mime_type}' is not allowed. Supported: PDF, images, Excel, Word, text, ZIP.`,
        },
        { status: 415 }, // 415 Unsupported Media Type
      );
    }

    // Bank-safe guardrails
    if (size_bytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, requestId, error: "File too large (max 50MB)" },
        { status: 413 },
      );
    }

    // Verify user has access to this deal (tenant check)
    const sb = supabaseAdmin();
    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");

    const { deal, error: dealErr } = await checkDealAccessWithRetries({ sb, dealId, bankId });

    if (dealErr || !deal) {
      console.error("[files/sign] deal access denied", { dealId, bankId, dealErr });
      return NextResponse.json(
        { ok: false, requestId, error: "deal_not_ready", hint: "Create deal before signing" },
        { status: 409 },
      );
    }

    const dealBankId = deal.bank_id ? String(deal.bank_id) : null;
    if (dealBankId && dealBankId !== bankId) {
      console.warn("[files/sign] deal bank mismatch", { dealId, bankId, dealBankId });
      return NextResponse.json(
        { ok: false, requestId, error: "deal_bank_mismatch" },
        { status: 403 },
      );
    }

    if (!dealBankId) {
      const up = await sb
        .from("deals")
        .update({ bank_id: bankId })
        .eq("id", dealId);
      if (up.error) {
        console.warn("[files/sign] failed to backfill bank_id", {
          dealId,
          bankId,
          error: up.error.message,
        });
      }
    }

    const docStore = String(process.env.DOC_STORE || "").toLowerCase();
    const headerSessionId = req.headers.get("x-buddy-upload-session-id");
    let uploadSessionId = headerSessionId || upload_session_id || session_id || null;
    let uploadSessionExpiresAt: string | null = null;

    if (uploadSessionId) {
      const validation = await validateUploadSession({
        sb,
        sessionId: uploadSessionId,
        dealId,
        bankId,
      });
      if (!validation.ok) {
        return NextResponse.json(
          { ok: false, requestId, error: validation.error },
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

    if (docStore === "gcs") {
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
          requestId,
          deduped: true,
          existingDocumentId: existing.id,
        });
      }

      const signResult = await signDealUpload({
        req,
        dealId,
        uploadSessionId,
        filename,
        mimeType: mime_type,
        sizeBytes: size_bytes,
        checklistKey: checklist_key,
        requestId,
      });

      if (!signResult.ok) {
        return NextResponse.json(
          {
            ok: false,
            requestId: signResult.requestId,
            error: signResult.error,
            details: signResult.details,
          },
          { status: 500 },
        );
      }

      if (uploadSessionId) {
        await upsertUploadSessionFile({
          sb,
          sessionId: uploadSessionId,
          dealId,
          bankId,
          fileId: signResult.upload.fileId,
          filename,
          contentType: mime_type || "application/octet-stream",
          sizeBytes: size_bytes,
          objectKey: signResult.upload.objectKey,
          bucket: signResult.upload.bucket,
        });
      }

      return NextResponse.json({
        ok: true,
        requestId,
        deduped: false,
        method: "PUT",
        uploadUrl: signResult.upload.uploadUrl,
        headers: signResult.upload.headers,
        objectKey: signResult.upload.objectKey,
        bucket: signResult.upload.bucket,
        upload_session_id: uploadSessionId,
        upload_session_expires_at: uploadSessionExpiresAt,
        upload: {
          file_id: signResult.upload.fileId,
          object_path: signResult.upload.objectKey,
          signed_url: signResult.upload.uploadUrl,
          token: null,
          checklist_key,
          bucket: signResult.upload.bucket,
          upload_session_id: uploadSessionId,
        },
      });
    }

    const signResult = await signDealUpload({
      req,
      dealId,
      uploadSessionId,
      filename,
      mimeType: mime_type,
      sizeBytes: size_bytes,
      checklistKey: checklist_key,
      requestId,
    });

    if (!signResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          requestId: signResult.requestId,
          error: signResult.error,
          details: signResult.details,
        },
        { status: 500 },
      );
    }

    if (uploadSessionId) {
      await upsertUploadSessionFile({
        sb,
        sessionId: uploadSessionId,
        dealId,
        bankId,
        fileId: signResult.upload.fileId,
        filename,
        contentType: mime_type || "application/octet-stream",
        sizeBytes: size_bytes,
        objectKey: signResult.upload.objectKey,
        bucket: signResult.upload.bucket,
      });
    }

    return NextResponse.json({
      ok: true,
      upload_session_id: uploadSessionId,
      upload_session_expires_at: uploadSessionExpiresAt,
      upload: {
        file_id: signResult.upload.fileId,
        object_path: signResult.upload.objectKey,
        signed_url: signResult.upload.uploadUrl,
        token: null,
        checklist_key,
        bucket: signResult.upload.bucket,
        upload_session_id: uploadSessionId,
      },
    });
  } catch (error: any) {
    const isTimeout = String(error?.message || "").startsWith("timeout:");
    console.error("[files/sign] uncaught exception", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return NextResponse.json(
      {
        ok: false,
        requestId: req.headers.get("x-request-id") || null,
        error: isTimeout ? "Request timed out" : "Internal server error",
        details: error.message || String(error),
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
