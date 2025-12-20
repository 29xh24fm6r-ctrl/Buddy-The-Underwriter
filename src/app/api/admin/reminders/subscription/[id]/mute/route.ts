// src/app/api/admin/reminders/subscription/[id]/mute/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Mute a reminder subscription (set active=false).
 * POST /api/admin/reminders/subscription/:id/mute
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  try {
    // Update subscription to inactive
    const { data, error } = await supabase
      .from("reminder_subscriptions")
      .update({ active: false })
      .eq("id", id)
      .select("id, deal_id, active")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Subscription muted",
      subscription_id: id,
      active: data.active,
    });
  } catch (err: any) {
    console.error("[mute-subscription]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Unmute a reminder subscription (set active=true).
 * DELETE /api/admin/reminders/subscription/:id/mute
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  try {
    const { data, error } = await supabase
      .from("reminder_subscriptions")
      .update({ active: true })
      .eq("id", id)
      .select("id, deal_id, active")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Subscription not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Subscription unmuted",
      subscription_id: id,
      active: data.active,
    });
  } catch (err: any) {
    console.error("[unmute-subscription]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
