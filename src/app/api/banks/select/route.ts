import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = auth();
  
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const bankId = body?.bankId as string | undefined;
  
  if (!bankId) {
    return NextResponse.json({ error: "bankId_required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // 1) Clear existing default (if any)
  const { error: clearErr } = await sb
    .from("user_banks")
    .update({ is_default: false })
    .eq("clerk_user_id", userId)
    .eq("is_default", true);

  if (clearErr) {
    return NextResponse.json({ error: clearErr.message }, { status: 500 });
  }

  // 2) Upsert mapping (and set default = true)
  // If row exists for (user, bank) we set is_default=true, else insert it.
  const { error: upsertErr } = await sb
    .from("user_banks")
    .upsert(
      {
        clerk_user_id: userId,
        bank_id: bankId,
        is_default: true,
      },
      { onConflict: "clerk_user_id,bank_id" }
    );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
