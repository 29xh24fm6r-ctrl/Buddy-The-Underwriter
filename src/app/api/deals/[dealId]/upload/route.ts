import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getRequestId(req: NextRequest) {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: any,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, details } },
    { status },
  );
}

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = getRequestId(req);

  try {
    const p = await ctx.params;
    const dealId = p?.dealId;
    if (!dealId) {
      return jsonError(400, "MISSING_DEAL_ID", "Missing dealId in URL");
    }

    const form = await req.formData();
    const file = form.get("file");
    const packId = form.get("pack_id") as string | null;

    if (!file || !(file instanceof File)) {
      return jsonError(
        400,
        "MISSING_FILE",
        "Missing file in form-data (key: file)",
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Guardrail: prevent someone from uploading a 2GB file and nuking memory
    const MAX_BYTES = 50 * 1024 * 1024; // 50MB
    if (bytes.length > MAX_BYTES) {
      return jsonError(
        413,
        "FILE_TOO_LARGE",
        "File exceeds max upload size (50MB).",
        {
          size: bytes.length,
          max: MAX_BYTES,
        },
      );
    }

    const baseDir = path.join("/tmp/buddy_uploads", dealId);
    await fs.mkdir(baseDir, { recursive: true });

    const fileId = crypto.randomUUID();
    const storedName = `${fileId}__${safeName(file.name || "upload.pdf")}`;
    const storedPath = path.join(baseDir, storedName);

    await fs.writeFile(storedPath, bytes);

    console.log("[upload] stored", {
      requestId,
      dealId,
      fileId,
      storedName,
      size: bytes.length,
      mime: file.type,
    });

    // Insert into database (deal_documents table)
    const { userId } = await auth();
    const sb = supabaseAdmin();
    
    const { data: dbFile, error: dbError } = await sb
      .from("deal_documents")
      .insert({
        id: fileId,
        deal_id: dealId,
        storage_bucket: "local_tmp",
        storage_path: storedPath,
        original_filename: file.name || "upload.pdf",
        mime_type: file.type || null,
        size_bytes: bytes.length,
        uploader_user_id: userId || null,
        source: "internal",
        checklist_key: null,
      })
      .select()
      .single();

    if (dbError) {
      console.error("[upload] database error", dbError);
      // Don't fail the upload if DB insert fails, just log it
    } else {
      console.log("[upload] saved to database", { fileId, dealId });
    }

    return NextResponse.json({
      ok: true,
      request_id: requestId,
      deal_id: dealId,
      file_id: fileId,
      stored_name: storedName,
      stored_path: storedPath,
      size: bytes.length,
      mime_type: file.type,
      pack_id: packId,
    });
  } catch (e: any) {
    console.error("[upload] error", {
      requestId,
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
    });

    return jsonError(
      500,
      "UPLOAD_UNHANDLED",
      "Internal server error during upload.",
      {
        message: e?.message ?? String(e),
        name: e?.name,
      },
    );
  }
}
