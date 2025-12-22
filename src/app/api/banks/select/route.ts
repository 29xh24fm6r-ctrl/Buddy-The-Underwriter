import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = await auth();
  
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const bankId = body?.bankId as string | undefined;
  
  if (!bankId) {
    return NextResponse.json({ error: "bankId_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // 1) Validate bank exists (prevent garbage mappings)
  const { data: bank, error: bankErr } = await sb
    .from("banks")
    .select("id")
    .eq("id", bankId)
    .maybeSingle();

  if (bankErr) {
    return NextResponse.json({ error: bankErr.message }, { status: 500 });
  }
  
  if (!bank) {
    return NextResponse.json({ error: "bank_not_found" }, { status: 404 });
  }

  // 2) Atomically set default bank (race-condition safe)
  const { error } = await sb.rpc("set_default_bank", {
    p_clerk_user_id: userId,
    p_bank_id: bankId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
