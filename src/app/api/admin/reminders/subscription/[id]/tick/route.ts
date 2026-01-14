// src/app/api/admin/reminders/subscription/[id]/tick/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

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

/**
 * Force-run a single reminder subscription (one-off tick).
 * POST /api/admin/reminders/subscription/:id/tick
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const { id } = await params;
  const supabase = supabaseAdmin();

  try {
    // 1. Verify subscription exists and is active
    const { data: sub, error: subErr } = await supabase
      .from("reminder_subscriptions")
      .select("id, deal_id, active")
      .eq("id", id)
      .single();

    if (subErr || !sub) {
      return NextResponse.json(
        { ok: false, error: "Subscription not found" },
        { status: 404 },
      );
    }

    if (!sub.active) {
      return NextResponse.json(
        { ok: false, error: "Subscription is not active" },
        { status: 400 },
      );
    }

    // 2. Send reminder immediately (simulate due state)
    const now = new Date().toISOString();

    // Call the reminder send logic
    const { data: dealData } = await supabase
      .from("deals")
      .select("id, borrower_email, name")
      .eq("id", sub.deal_id)
      .single();

    if (!dealData?.borrower_email) {
      return NextResponse.json(
        { ok: false, error: "Deal missing borrower email" },
        { status: 400 },
      );
    }

    // Send the email (simplified - you might want to reuse your existing send logic)
    const emailRes = await fetch(
      `${request.url.split("/api")[0]}/api/email/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: dealData.borrower_email,
          subject: `Reminder: ${dealData.name}`,
          html: `<p>This is a manual reminder for deal: <strong>${dealData.name}</strong></p>
               <p>Triggered via War Room control panel.</p>`,
          from: "reminders@buddy.com",
        }),
      },
    );

    const emailOk = emailRes.ok;

    // 3. Log the run
    const runInsert = {
      subscription_id: id,
      ran_at: now,
      status: emailOk ? ("sent" as const) : ("error" as const),
      error: emailOk ? null : "Email send failed",
      meta: { source: "war_room_force_tick", deal_id: sub.deal_id },
    };

    await supabase.from("deal_reminder_runs").insert(runInsert);

    // 4. Update next_run_at to prevent immediate re-run
    const { data: subConfig } = await supabase
      .from("reminder_subscriptions")
      .select("frequency_days")
      .eq("id", id)
      .single();

    const days = subConfig?.frequency_days || 7;
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + days);

    await supabase
      .from("reminder_subscriptions")
      .update({ next_run_at: nextRun.toISOString() })
      .eq("id", id);

    return NextResponse.json({
      ok: true,
      message: "Force-tick successful",
      subscription_id: id,
      status: emailOk ? "sent" : "error",
      next_run_at: nextRun.toISOString(),
    });
  } catch (err: any) {
    console.error("[force-tick]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal error" },
      { status: 500 },
    );
  }
}
