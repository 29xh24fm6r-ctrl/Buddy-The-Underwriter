// src/app/api/portal/share/upload/route.ts
import { NextResponse } from "next/server";
import { requireValidShareToken } from "@/lib/portal/shareAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { rateLimit } from "@/lib/portal/ratelimit";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kept in sync with the borrower portal's own upload allowlist
// (src/app/api/portal/[token]/files/sign/route.ts).
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

const MAX_BYTES = 50 * 1024 * 1024; // 50MB

/**
 * POST /api/portal/share/upload
 *
 * This route never existed — src/app/portal/share/[token]/page.tsx's
 * upload widget was a scaffold that posted here with a literal
 * "// NOTE: Wire this into your existing upload pipeline" comment, so
 * every upload attempt on the share-link page 404'd. Wires it into the
 * same storage + canonical ingestion pipeline the token portal uses
 * (see /api/portal/[token]/files/sign + /files/record), collapsed into a
 * single request since this widget does a direct multipart POST rather
 * than a signed-URL two-step.
 */
export async function POST(req: Request) {
  try {
    const { share, dealId, token } = await requireValidShareToken(req);

    const rl = rateLimit(`portal_share:${token.slice(0, 12)}:upload`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ ok: false, error: "Rate limited" }, { status: 429 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const filenameField = form.get("filename");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const filename =
      (typeof filenameField === "string" && filenameField.trim()) ||
      (file as File).name ||
      "upload";

    const mimeType = file.type || "application/octet-stream";
    if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unsupported file type",
          details: `File type '${mimeType}' is not allowed. Supported: PDF, images, Excel, Word, text, ZIP.`,
        },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
    }
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "File too large (max 50MB)" }, { status: 413 });
    }

    const sb = supabaseAdmin();
    const { data: deal } = await sb
      .from("deals")
      .select("bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal?.bank_id) {
      return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const bucket = process.env.SUPABASE_UPLOAD_BUCKET || "deal-files";
    const objectPath = `deals/${dealId}/share/${crypto.randomUUID()}__${safeName}`;

    const { error: uploadError } = await sb.storage
      .from(bucket)
      .upload(objectPath, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error("[portal/share/upload] storage upload failed", {
        dealId,
        objectPath,
        error: uploadError.message,
      });
      return NextResponse.json({ ok: false, error: "Failed to store file" }, { status: 500 });
    }

    const result = await ingestDocument({
      dealId,
      bankId: deal.bank_id,
      file: {
        original_filename: filename,
        mimeType,
        sizeBytes: buffer.length,
        storagePath: objectPath,
        storageBucket: bucket,
      },
      // "public" — a share link may go to a co-owner, accountant, or other
      // third party, not necessarily the borrower themselves.
      source: "public",
      metadata: {
        skip_filename_match: true,
        share_token_recipient: share.recipient_name ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      documentId: result.documentId,
      checklistKey: result.checklistKey ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "upload_failed" },
      { status: 400 },
    );
  }
}
