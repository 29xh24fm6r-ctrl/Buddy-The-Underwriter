// POST /api/banks/documents/upload - Upload a bank document
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { requireBankAdmin } from "@/lib/auth/requireBankAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "bank-documents";

// Allowed MIME types for v1
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

// Fallback: check by extension if MIME type is generic
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "png",
  "jpg",
  "jpeg",
]);

export async function POST(req: Request) {
  // Get current bank ID (also validates Clerk auth internally)
  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_authenticated") {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "tenant_missing", detail: msg },
      { status: 400 }
    );
  }

  // Get user ID for admin check
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 }
    );
  }

  // Bank admin check
  try {
    await requireBankAdmin(bankId, userId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "forbidden") {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { ok: false, error: "auth_check_failed" },
      { status: 500 }
    );
  }

  // Parse multipart form
  const form = await req.formData();
  const file = form.get("file");
  const titleRaw = String(form.get("title") || "").trim();
  const descriptionRaw = String(form.get("description") || "").trim();
  const categoryRaw = String(form.get("category") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "missing_file" },
      { status: 400 }
    );
  }

  // Validate file type
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mimeAllowed = ALLOWED_MIME_TYPES.has(file.type);
  const extAllowed = ALLOWED_EXTENSIONS.has(ext);

  if (!mimeAllowed && !extAllowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_file_type",
        detail: "Allowed types: PDF, DOC, DOCX, PNG, JPG",
      },
      { status: 400 }
    );
  }

  const title = titleRaw || file.name;
  const description = descriptionRaw || null;
  const category = categoryRaw || "CREDIT_POLICY";

  const sb = supabaseAdmin();

  // Generate document ID
  const docId = crypto.randomUUID();

  // Sanitize filename for storage path
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `banks/${bankId}/${docId}/${safeFilename}`;

  const mime = file.type || "application/octet-stream";
  const arrayBuf = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  // Upload to storage
  const uploadResult = await sb.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: false });

  if (uploadResult.error) {
    console.error("[bank-documents] upload error:", uploadResult.error.message);
    return NextResponse.json(
      { ok: false, error: "storage_upload_failed", detail: uploadResult.error.message },
      { status: 500 }
    );
  }

  // Insert metadata row
  const insertResult = await sb.from("bank_documents").insert({
    id: docId,
    bank_id: bankId,
    title,
    description,
    category,
    storage_bucket: BUCKET,
    storage_path: storagePath,
    original_filename: file.name,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    uploaded_by: userId,
  }).select().single();

  if (insertResult.error) {
    // Best-effort cleanup storage if metadata insert fails
    try {
      await sb.storage.from(BUCKET).remove([storagePath]);
    } catch {}
    console.error("[bank-documents] insert error:", insertResult.error.message);
    return NextResponse.json(
      { ok: false, error: "metadata_insert_failed", detail: insertResult.error.message },
      { status: 500 }
    );
  }

  // Structured event logging
  console.log(
    JSON.stringify({
      event: "bank.document.uploaded",
      bank_id: bankId,
      bank_document_id: docId,
      category,
      filename: file.name,
      mime_type: mime,
      size_bytes: bytes.byteLength,
      uploaded_by: userId,
      timestamp: new Date().toISOString(),
    })
  );

  return NextResponse.json({ ok: true, document: insertResult.data });
}
