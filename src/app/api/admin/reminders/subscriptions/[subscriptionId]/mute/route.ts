// src/app/api/admin/reminders/subscriptions/[subscriptionId]/mute/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
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
