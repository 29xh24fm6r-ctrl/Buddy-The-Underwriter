// src/app/api/admin/reminders/subscriptions/[subscriptionId]/mute/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function enforceSuperAdmin() {
  try {
    await requireSuperAdmin();
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg === "unauthorized")
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    if (msg === "forbidden")
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 },
      );
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const { subscriptionId } = await params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_reminder_subscriptions")
    .update({ active: false })
    .eq("id", subscriptionId)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "mute_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, subscription: data ?? null });
}
