import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/bank/documents
 *
 * List bank documents for the current user's bank.
 * Validates membership via getCurrentBankId.
 */
export async function GET() {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "no_bank_context" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bank_documents")
    .select("id, bank_id, title, description, category, original_filename, mime_type, size_bytes, uploaded_by, created_at")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /api/bank/documents]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, documents: data ?? [], bank_id: bankId });
}

/**
 * POST /api/bank/documents
 *
 * Create a bank document record (metadata only — file upload handled separately via storage).
 * Validates membership via getCurrentBankId.
 */
export async function POST(req: NextRequest) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "no_bank_context" },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const original_filename = typeof body.original_filename === "string" ? body.original_filename.trim() : "";

  if (!title || !original_filename) {
    return NextResponse.json(
      { ok: false, error: "title and original_filename are required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bank_documents")
    .insert({
      bank_id: bankId,
      title,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      category: typeof body.category === "string" ? body.category.trim() || "general" : "general",
      storage_bucket: "bank-documents",
      storage_path: `${bankId}/${Date.now()}_${original_filename}`,
      original_filename,
      mime_type: typeof body.mime_type === "string" ? body.mime_type : null,
      size_bytes: typeof body.size_bytes === "number" ? body.size_bytes : null,
      uploaded_by: userId,
    })
    .select("id, bank_id, title, description, category, original_filename, mime_type, size_bytes, uploaded_by, created_at")
    .single();

  if (error) {
    console.error("[POST /api/bank/documents]", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, document: data }, { status: 201 });
}
