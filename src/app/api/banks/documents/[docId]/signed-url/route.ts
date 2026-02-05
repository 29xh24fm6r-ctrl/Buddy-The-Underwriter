// POST /api/banks/documents/[docId]/signed-url - Generate signed download URL
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { requireBankAdmin } from "@/lib/auth/requireBankAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Signed URL expires in 5 minutes
const SIGNED_URL_EXPIRY_SECONDS = 300;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;

  // Validate docId is a UUID
  if (!UUID_REGEX.test(docId)) {
    return NextResponse.json(
      { ok: false, error: "invalid_doc_id" },
      { status: 400 }
    );
  }

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

  const sb = supabaseAdmin();

  // Verify document exists and belongs to this bank
  const { data: doc, error: docError } = await sb
    .from("bank_documents")
    .select("storage_bucket, storage_path")
    .eq("id", docId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (docError) {
    console.error("[bank-documents] doc lookup error:", docError.message);
    return NextResponse.json(
      { ok: false, error: "lookup_failed" },
      { status: 500 }
    );
  }

  if (!doc) {
    return NextResponse.json(
      { ok: false, error: "document_not_found" },
      { status: 404 }
    );
  }

  // Generate signed URL
  const { data: signedUrlData, error: signedUrlError } = await sb.storage
    .from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, SIGNED_URL_EXPIRY_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error("[bank-documents] signed URL error:", signedUrlError?.message);
    return NextResponse.json(
      { ok: false, error: "signed_url_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, url: signedUrlData.signedUrl });
}
