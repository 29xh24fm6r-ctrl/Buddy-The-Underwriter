import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bank-grade MIME type allowlist (same as banker endpoint)
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
 * POST /api/borrower/portal/[token]/files/sign
 * 
 * Borrower portal version of signed upload URL generator.
 * Authorization via portal token (borrower_portal_links).
 * Returns deal_id + signed URL for storage upload.
 * 
 * Flow:
 * 1. Validate portal token → get deal_id
 * 2. Validate file metadata
 * 3. Generate signed upload URL
 * 4. Client uploads directly to storage
 * 5. Client calls /files/record with deal_id
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
    } = body ?? {};

    if (!filename || !size_bytes) {
      return NextResponse.json(
        { ok: false, error: "Missing filename or size_bytes" },
        { status: 400 },
      );
    }

    // MIME type enforcement (same security as banker endpoint)
    if (mime_type && !ALLOWED_MIME_TYPES.has(mime_type)) {
      console.warn("[borrower/portal/files/sign] rejected unsupported MIME type", {
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
      console.error("[borrower/portal/files/sign] invalid token", { token, linkErr });
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

    // Generate unique file ID and safe path
    const fileId = crypto.randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `deals/${dealId}/${fileId}__${safeName}`;

    // Create signed upload URL (valid for 5 minutes)
    const { data: signed, error: signErr } = await sb.storage
      .from("deal-documents")
      .createSignedUploadUrl(objectPath);

    if (signErr || !signed) {
      console.error("[borrower/portal/files/sign] failed to create signed URL", signErr);
      return NextResponse.json(
        { ok: false, error: "Failed to generate upload URL" },
        { status: 500 },
      );
    }

    console.log("[borrower/portal/files/sign] created signed URL", {
      dealId,
      fileId,
      filename: safeName,
      size_bytes,
      token,
    });

    return NextResponse.json({
      ok: true,
      deal_id: dealId, // Return deal_id so client can call /files/record
      upload: {
        file_id: fileId,
        object_path: objectPath,
        signed_url: signed.signedUrl,
        token: signed.token,
        checklist_key,
        mime_type,
      },
    });
  } catch (error: any) {
    console.error("[borrower/portal/files/sign]", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
