import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { signUploadUrl } from "@/lib/uploads/sign";

export const runtime = "edge";
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
    } = body ?? {};

    if (!filename || !size_bytes) {
      return NextResponse.json(
        { ok: false, error: "Missing filename or size_bytes" },
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
        { ok: false, error: "File too large (max 50MB)" },
        { status: 413 },
      );
    }

    // Verify user has access to this deal (tenant check)
    const sb = supabaseAdmin();
    const bankId = await withTimeout(getCurrentBankId(), 8_000, "getCurrentBankId");

    const { data: deal, error: dealErr } = await withTimeout(
      sb
        .from("deals")
        .select("id")
        .eq("id", dealId)
        .eq("bank_id", bankId)
        .maybeSingle(),
      8_000,
      "checkDealAccess",
    );

    if (dealErr || !deal) {
      console.error("[files/sign] deal access denied", { dealId, bankId, dealErr });
      return NextResponse.json(
        { ok: false, error: "Deal not found or access denied" },
        { status: 403 },
      );
    }

    // Generate unique file ID and safe path
  const fileId = randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `deals/${dealId}/${fileId}__${safeName}`;

    // Canonical bucket (matches DB default)
    const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";

    // Diagnostic logging (will show in Vercel function logs)
    console.log("[files/sign] pre-flight check", {
      dealId,
      fileId,
      bucket,
      objectPath,
      has_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      has_url: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
      env_bucket: process.env.SUPABASE_UPLOAD_BUCKET || null,
    });

    // Use centralized signing utility
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
        bucket, // Diagnostic: client can verify bucket alignment
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
        error: isTimeout ? "Request timed out" : "Internal server error",
        details: error.message || String(error),
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
