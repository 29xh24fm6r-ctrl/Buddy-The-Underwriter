// GET /api/banks/documents/list - List bank documents for current bank
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { requireBankAdmin } from "@/lib/auth/requireBankAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  // Query documents
  const sb = supabaseAdmin();
  const { data: documents, error } = await sb
    .from("bank_documents")
    .select("*")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[bank-documents] list error:", error.message);
    return NextResponse.json(
      { ok: false, error: "query_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, documents: documents ?? [], bankId });
}
