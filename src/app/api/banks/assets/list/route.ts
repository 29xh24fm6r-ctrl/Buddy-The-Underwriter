// src/app/api/banks/assets/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  const q = await supabaseAdmin()
    .from("bank_assets")
    .select(
      "id,bank_id,kind,title,description,storage_path,mime_type,size_bytes,version,active,created_at",
    )
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (q.error)
    return NextResponse.json(
      { ok: false, error: "list_failed", detail: q.error.message },
      { status: 500 },
    );

  return NextResponse.json({ ok: true, items: q.data ?? [] });
}
