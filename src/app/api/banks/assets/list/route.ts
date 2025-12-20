// src/app/api/banks/assets/list/route.ts
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();

  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  let bankId: string;
  try { bankId = await getCurrentBankId(); }
  catch (e: any) { return NextResponse.json({ ok: false, error: "tenant_missing", detail: String(e?.message || "") }, { status: 400 }); }

  const q = await sb
    .from("bank_assets")
    .select("id,bank_id,kind,title,description,storage_path,mime_type,size_bytes,version,active,created_at")
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (q.error) return NextResponse.json({ ok: false, error: "list_failed", detail: q.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, items: q.data ?? [] });
}
