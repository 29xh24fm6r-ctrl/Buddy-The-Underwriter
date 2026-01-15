// src/app/api/admin/reminders/subscriptions/[subscriptionId]/route.ts
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ subscriptionId: string }> },
) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const { subscriptionId } = await params;
  const sb = supabaseAdmin();

  // Fetch the subscription row (we avoid guessing columns; select * is OK for admin ops)
  const subRes = await sb
    .from("deal_reminder_subscriptions")
    .select("*")
    .eq("id", subscriptionId)
    .limit(1)
    .maybeSingle();

  if (subRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "subscription_fetch_failed",
        detail: subRes.error.message,
      },
      { status: 500 },
    );
  }

  if (!subRes.data) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );
  }

  // Recent runs for this subscription
  const runsRes = await sb
    .from("deal_reminder_runs")
    .select("id,subscription_id,due_at,ran_at,status,error,meta")
    .eq("subscription_id", subscriptionId)
    .order("ran_at", { ascending: false })
    .limit(50);

  if (runsRes.error) {
    return NextResponse.json(
      { ok: false, error: "runs_fetch_failed", detail: runsRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    subscription: subRes.data,
    runs: runsRes.data ?? [],
  });
}
