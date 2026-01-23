import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { signUploadUrl } from "@/lib/uploads/sign";
import { getGcsBucketName } from "@/lib/storage/gcs";
import { findExistingDocBySha } from "@/lib/storage/dedupe";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { getVercelOidcToken } from "@/lib/google/vercelOidc";
import { exchangeOidcForFederatedAccessToken } from "@/lib/google/wifSts";
import { generateAccessToken, signBlob } from "@/lib/google/iamCredentials";
import { createV4SignedPutUrl } from "@/lib/google/gcsV4Signer";

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

// Bank-grade MIME type allowlist (SBA-compliant document types)
const ALLOWED_MIME_TYPES = new Set([
  // PDFs (most common for financial documents)
  "application/pdf",
  
  // Images (scanned documents, photos of receipts, etc.)
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/tif",
  "image/gif",
  "image/webp",
  
  // Excel/Spreadsheets (financial statements, P&L, balance sheets)
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
  
  // Word documents (business plans, narratives)
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  
  // Plain text (sometimes used for simple disclosures)
  "text/plain",
  
  // ZIP archives (multi-document packages)
  "application/zip",
  "application/x-zip-compressed",
]);

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
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB
    if (size_bytes > MAX_BYTES) {
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
        { ok: false, requestId, error: "deal_not_found" },
        { status: 404 },
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
    const wantsGcs = docStore === "gcs";
    const uploadPrefix = process.env.GCS_UPLOAD_PREFIX || "deals";
    const expiresSeconds = Number(process.env.GCS_SIGN_TTL_SECONDS || "900");
    const region = process.env.GCS_SIGN_REGION || "us-central1";
    const gcsBucket = process.env.GCS_BUCKET || getGcsBucketName();
    const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL || "";
    const hasGcsConfig = Boolean(gcsBucket && serviceAccountEmail && process.env.GCP_WORKLOAD_IDENTITY_PROVIDER);
    const strictGcs = process.env.GCS_STRICT_SIGNING === "1";
    const docStoreEffective = wantsGcs && (!hasGcsConfig && !strictGcs) ? "supabase" : docStore;

    if (wantsGcs && !hasGcsConfig && !strictGcs) {
      console.warn("[files/sign] missing gcs config, falling back to supabase", {
        requestId,
        bucket: Boolean(gcsBucket),
        serviceAccountEmail: Boolean(serviceAccountEmail),
        hasWorkloadProvider: Boolean(process.env.GCP_WORKLOAD_IDENTITY_PROVIDER),
      });
    }

    if (docStoreEffective === "gcs") {
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

      const fileId = randomUUID();
      const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      const objectPath = `${uploadPrefix}/${dealId}/${fileId}-${safeName}`;

      if (!hasGcsConfig) {
        return NextResponse.json(
          {
            ok: false,
            requestId,
            error: "missing_gcp_config",
            message: "Missing GCP signing configuration.",
            hint: "Set GCS_BUCKET, GCP_SERVICE_ACCOUNT_EMAIL, and GCP_WORKLOAD_IDENTITY_PROVIDER.",
          },
          { status: 500 },
        );
      }

      const oidc = getVercelOidcToken(req);
      if (!oidc) {
        return NextResponse.json(
          {
            ok: false,
            requestId,
            error: "missing_vercel_oidc",
            message: "Vercel OIDC token not present.",
            hint: "Ensure Vercel OIDC is enabled and forwarded to this route.",
          },
          { status: 500 },
        );
      }

      const federated = await exchangeOidcForFederatedAccessToken(oidc);
      const saToken = await generateAccessToken(federated);
      const signed = await createV4SignedPutUrl({
        bucket: gcsBucket,
        objectKey: objectPath,
        contentType: mime_type || "application/octet-stream",
        expiresSeconds,
        region,
        serviceAccountEmail,
        signBlob: (bytes) => signBlob(saToken, bytes),
      });

      const expiresAt = new Date(Date.now() + expiresSeconds * 1000).toISOString();

      return NextResponse.json({
        ok: true,
        requestId,
        deduped: false,
        method: "PUT",
        uploadUrl: signed.url,
        headers: signed.headers,
        objectKey: signed.objectKey,
        bucket: gcsBucket,
        expiresAt,
        upload: {
          file_id: fileId,
          object_path: objectPath,
          signed_url: signed.url,
          token: null,
          checklist_key,
          bucket: gcsBucket,
        },
      });
    }

    // Supabase Storage (legacy)
    const fileId = randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `deals/${dealId}/${fileId}__${safeName}`;

    const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";

    console.log("[files/sign] pre-flight check", {
      dealId,
      fileId,
      bucket,
      objectPath,
      has_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      has_url: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
      env_bucket: process.env.SUPABASE_UPLOAD_BUCKET || null,
    });

    const signResult = await withTimeout(
      signUploadUrl({ bucket, objectPath }),
      12_000,
      "signUploadUrl",
    );

    if (!signResult.ok) {
      console.error("[files/sign] failed to create signed URL", {
        requestId: signResult.requestId,
        error: signResult.error,
        detail: signResult.detail,
      });
      return NextResponse.json(
        {
          ok: false,
          requestId: signResult.requestId,
          error: signResult.error,
          details: signResult.detail || "Unknown storage error",
        },
        { status: 500 },
      );
    }

    const signed = {
      signedUrl: signResult.signedUrl,
      token: signResult.token,
      path: signResult.path,
    };

    console.log("[files/sign] created signed URL", {
      dealId,
      fileId,
      filename: safeName,
      size_bytes,
      bucket,
    });

    return NextResponse.json({
      ok: true,
      upload: {
        file_id: fileId,
        object_path: objectPath,
        signed_url: signed.signedUrl,
        token: signed.token,
        checklist_key,
        bucket,
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
