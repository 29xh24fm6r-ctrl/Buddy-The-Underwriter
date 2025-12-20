import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));
  const bankId = String(body?.bank_id || "").trim();

  if (!bankId) {
    return NextResponse.json({ ok: false, error: "missing_bank_id" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // Validate bank exists
  const { data: bank, error: bErr } = await supabase
    .from("banks")
    .select("id")
    .eq("id", bankId)
    .maybeSingle();

  if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
  if (!bank) return NextResponse.json({ ok: false, error: "bank_not_found" }, { status: 404 });

  // Upsert profile
  const { error: pErr } = await supabase
    .from("profiles")
    .upsert(
      {
        clerk_user_id: userId,
        bank_id: bankId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" }
    );

  if (pErr) {
    return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
