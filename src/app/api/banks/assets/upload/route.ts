// src/app/api/banks/assets/upload/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "bank-assets";

export async function POST(req: Request) {
  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (msg === "not_authenticated") {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "tenant_missing", detail: msg },
      { status: 400 },
    );
  }

  const { userId } = await clerkAuth();

  const form = await req.formData();
  const kind = String(form.get("kind") || "").trim();
  const title = String(form.get("title") || "").trim();
  const descriptionRaw = String(form.get("description") || "").trim();
  const description = descriptionRaw ? descriptionRaw : null;

  const file = form.get("file");
  if (!kind)
    return NextResponse.json(
      { ok: false, error: "missing_kind" },
      { status: 400 },
    );
  if (!title)
    return NextResponse.json(
      { ok: false, error: "missing_title" },
      { status: 400 },
    );
  if (!(file instanceof File))
    return NextResponse.json(
      { ok: false, error: "missing_file" },
      { status: 400 },
    );

  // Admin client for storage + insert (service-role)
  const sb = supabaseAdmin();

  const assetId = crypto.randomUUID();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const storage_path = `${bankId}/${kind}/${assetId}.${safeExt}`;

  const mime = file.type || "application/octet-stream";
  const arrayBuf = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);

  const up = await sb.storage
    .from(BUCKET)
    .upload(storage_path, bytes, { contentType: mime, upsert: false });

  if (up.error) {
    return NextResponse.json(
      { ok: false, error: "storage_upload_failed", detail: up.error.message },
      { status: 500 },
    );
  }

  const ins = await sb.from("bank_assets").insert({
    id: assetId,
    bank_id: bankId,
    kind,
    title,
    description,
    storage_bucket: BUCKET,
    storage_path,
    mime_type: mime,
    size_bytes: bytes.byteLength,
    version: 1,
    active: true,
    created_by: userId,
  });

  if (ins.error) {
    // best-effort cleanup storage if metadata insert fails
    try {
      await sb.storage.from(BUCKET).remove([storage_path]);
    } catch {}
    return NextResponse.json(
      { ok: false, error: "metadata_insert_failed", detail: ins.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: assetId, storage_path });
}
