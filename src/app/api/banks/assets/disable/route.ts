// src/app/api/banks/assets/disable/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const form = await req.formData();
  const id = String(form.get("id") || "").trim();
  if (!id)
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 },
    );

  const up = await supabaseAdmin()
    .from("bank_assets")
    .update({ active: false })
    .eq("id", id)
    .eq("bank_id", bankId);
  if (up.error)
    return NextResponse.json(
      { ok: false, error: "disable_failed", detail: up.error.message },
      { status: 500 },
    );

  return NextResponse.redirect(new URL("/banks/settings/documents", req.url), {
    status: 303,
  });
}
