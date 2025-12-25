// src/app/api/deals/[dealId]/borrower-request/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  // Delivery
  channel: "email" | "sms" | string;
  destination: string;

  // Optional messaging (stored/used elsewhere)
  subject?: string;
  message?: string;

  // Canonical scheduling knobs
  startInHours?: number; // default 24
  cadenceDays?: number; // default 3 (stored as cadence_days)
  active?: boolean; // default true

  // Canonical behavioral knobs you already have in DB
  missingOnly?: boolean; // default true
  stopAfterIso?: string; // optional ISO string
};

/**
 * Borrower request "send" route:
 * - Creates/updates a canonical reminder subscription:
 *    active
 *    next_run_at
 *
 * We also persist other existing canonical DB columns:
 * - channel
 * - destination
 * - cadence_days
 * - missing_only
 * - stop_after
 *
 * Important: do NOT write columns that don't exist in DB (e.g. updated_at).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const channel = String(body.channel || "").trim();
  const destination = String(body.destination || "").trim();

  if (!channel) {
    return NextResponse.json(
      { ok: false, error: "Missing channel." },
      { status: 400 },
    );
  }
  if (!destination) {
    return NextResponse.json(
      { ok: false, error: "Missing destination." },
      { status: 400 },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  const isActive = body.active ?? true;

  const startInHours = Math.max(
    0,
    Math.min(24 * 30, Number(body.startInHours ?? 24)),
  );
  const cadenceDays = Math.max(1, Math.min(365, Number(body.cadenceDays ?? 3)));
  const missingOnly = body.missingOnly ?? true;
  const stopAfterIso = body.stopAfterIso ? String(body.stopAfterIso) : null;

  // Compute next_run_at:
  // - if startInHours provided => now + startInHours
  // - else => now + cadenceDays
  const nextRunAt = new Date(
    now.getTime() +
      (startInHours > 0
        ? startInHours * 60 * 60 * 1000
        : cadenceDays * 24 * 60 * 60 * 1000),
  ).toISOString();

  // Upsert behavior: update existing subscription for same deal + channel + destination
  const { data: existing, error: exErr } = await sb
    .from("deal_reminder_subscriptions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("channel", channel)
    .eq("destination", destination)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to check existing reminder subscription.",
        detail: exErr.message,
      },
      { status: 500 },
    );
  }

  if (existing?.id) {
    const { error: upErr } = await sb
      .from("deal_reminder_subscriptions")
      .update({
        // canonical
        active: isActive,
        next_run_at: nextRunAt,

        // existing DB columns
        cadence_days: cadenceDays,
        missing_only: missingOnly,
        stop_after: stopAfterIso,

        // legacy/back-compat
        enabled: isActive,
      })
      .eq("id", existing.id);

    if (upErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to update reminder subscription.",
          detail: upErr.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      dealId,
      subscriptionId: existing.id,
      channel,
      destination,
      active: isActive,
      next_run_at: nextRunAt,
      cadence_days: cadenceDays,
      missing_only: missingOnly,
      stop_after: stopAfterIso,
      mode: "updated",
    });
  }

  const { data: inserted, error: insErr } = await sb
    .from("deal_reminder_subscriptions")
    .insert({
      deal_id: dealId,

      // existing DB columns
      channel,
      destination,
      cadence_days: cadenceDays,
      missing_only: missingOnly,
      stop_after: stopAfterIso,

      // canonical
      active: isActive,
      next_run_at: nextRunAt,

      // legacy/back-compat
      enabled: isActive,

      // created_at exists in your schema
      created_at: nowIso,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to create reminder subscription.",
        detail: insErr?.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    dealId,
    subscriptionId: inserted.id,
    channel,
    destination,
    active: isActive,
    next_run_at: nextRunAt,
    cadence_days: cadenceDays,
    missing_only: missingOnly,
    stop_after: stopAfterIso,
    mode: "inserted",
  });
}
