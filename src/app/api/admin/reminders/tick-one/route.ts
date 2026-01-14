// src/app/api/admin/reminders/tick-one/route.ts
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

type SubscriptionRow = {
  id: string;
  active: boolean;
  next_run_at: string;
  cadence_days: number | null;
  stop_after: string | null;
};

type ReminderRunInsert = {
  subscription_id: string;
  due_at: string | null;
  ran_at: string;
  status: "sent" | "skipped" | "error";
  error?: string | null;
  meta?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const sb = supabaseAdmin();
  const url = new URL(req.url);

  // Accept in query or JSON
  const qId = url.searchParams.get("subscription_id");
  const force =
    url.searchParams.get("force") === "1" ||
    url.searchParams.get("force") === "true";

  let bodyId: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    bodyId = body?.subscription_id ? String(body.subscription_id) : null;
  } catch {
    // ignore
  }

  const subscriptionId = (qId || bodyId || "").trim();
  if (!subscriptionId) {
    return NextResponse.json(
      { ok: false, error: "missing_subscription_id" },
      { status: 400 },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Fetch subscription (canonical fields only)
  const subRes = await sb
    .from("deal_reminder_subscriptions")
    .select("id,active,next_run_at,cadence_days,stop_after")
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

  const sub = subRes.data as SubscriptionRow;

  // inactive => skip (unless force? even then, we keep safe and skip)
  if (!sub.active) {
    await sb.from("deal_reminder_runs").insert({
      subscription_id: sub.id,
      due_at: sub.next_run_at ?? null,
      ran_at: nowIso,
      status: "skipped",
      error: "inactive",
      meta: { force },
    } satisfies ReminderRunInsert);

    return NextResponse.json({
      ok: true,
      status: "skipped",
      reason: "inactive",
    });
  }

  // stop_after passed => deactivate + skip
  if (sub.stop_after && new Date(sub.stop_after).getTime() <= now.getTime()) {
    const deact = await sb
      .from("deal_reminder_subscriptions")
      .update({ active: false })
      .eq("id", sub.id);

    if (deact.error) {
      await sb.from("deal_reminder_runs").insert({
        subscription_id: sub.id,
        due_at: sub.next_run_at ?? null,
        ran_at: nowIso,
        status: "error",
        error: `deactivate_failed: ${deact.error.message}`,
        meta: { stop_after: sub.stop_after },
      } satisfies ReminderRunInsert);

      return NextResponse.json(
        { ok: false, error: "deactivate_failed", detail: deact.error.message },
        { status: 500 },
      );
    }

    await sb.from("deal_reminder_runs").insert({
      subscription_id: sub.id,
      due_at: sub.next_run_at ?? null,
      ran_at: nowIso,
      status: "skipped",
      error: "stop_after_reached",
      meta: { stop_after: sub.stop_after },
    } satisfies ReminderRunInsert);

    return NextResponse.json({
      ok: true,
      status: "skipped",
      reason: "stop_after_reached",
    });
  }

  // Compute next_run_at
  const cadenceHoursFallback = 24;
  const cadenceMs =
    sub.cadence_days && sub.cadence_days > 0
      ? sub.cadence_days * 24 * 60 * 60 * 1000
      : cadenceHoursFallback * 60 * 60 * 1000;

  const nextRunAtIso = new Date(now.getTime() + cadenceMs).toISOString();
  const dueAtIso = sub.next_run_at ?? null;

  // Idempotency guard:
  // If not forcing, ensure it was due (<= now) and only advance if next_run_at unchanged.
  if (!force) {
    const dueMs = dueAtIso
      ? new Date(dueAtIso).getTime()
      : Number.POSITIVE_INFINITY;
    if (!(Number.isFinite(dueMs) && dueMs <= now.getTime())) {
      await sb.from("deal_reminder_runs").insert({
        subscription_id: sub.id,
        due_at: dueAtIso,
        ran_at: nowIso,
        status: "skipped",
        error: "not_due",
        meta: { now: nowIso },
      } satisfies ReminderRunInsert);

      return NextResponse.json({
        ok: true,
        status: "skipped",
        reason: "not_due",
      });
    }
  }

  // Advance using optimistic concurrency: next_run_at must match what we read.
  const adv = await sb
    .from("deal_reminder_subscriptions")
    .update({
      next_run_at: nextRunAtIso,
      last_sent_at: nowIso, // legacy exists in your table
    })
    .eq("id", sub.id)
    .eq("active", true)
    .eq("next_run_at", dueAtIso)
    .select("id")
    .limit(1);

  if (adv.error) {
    await sb.from("deal_reminder_runs").insert({
      subscription_id: sub.id,
      due_at: dueAtIso,
      ran_at: nowIso,
      status: "error",
      error: `advance_failed: ${adv.error.message}`,
      meta: { attempted_next: nextRunAtIso, force },
    } satisfies ReminderRunInsert);

    return NextResponse.json(
      { ok: false, error: "advance_failed", detail: adv.error.message },
      { status: 500 },
    );
  }

  if (!adv.data || adv.data.length === 0) {
    await sb.from("deal_reminder_runs").insert({
      subscription_id: sub.id,
      due_at: dueAtIso,
      ran_at: nowIso,
      status: "skipped",
      error: "race_lost",
      meta: { attempted_next: nextRunAtIso, force },
    } satisfies ReminderRunInsert);

    return NextResponse.json({
      ok: true,
      status: "skipped",
      reason: "race_lost",
    });
  }

  // Winner logs sent
  const runIns = await sb.from("deal_reminder_runs").insert({
    subscription_id: sub.id,
    due_at: dueAtIso,
    ran_at: nowIso,
    status: "sent",
    meta: {
      cadence_days: sub.cadence_days,
      advanced_to: nextRunAtIso,
      force,
    },
  } satisfies ReminderRunInsert);

  if (runIns.error) {
    // We already advanced schedule; record the insert failure as an error run
    await sb.from("deal_reminder_runs").insert({
      subscription_id: sub.id,
      due_at: dueAtIso,
      ran_at: nowIso,
      status: "error",
      error: `run_insert_failed: ${runIns.error.message}`,
      meta: { advanced_to: nextRunAtIso, force },
    } satisfies ReminderRunInsert);
  }

  return NextResponse.json({
    ok: true,
    status: "sent",
    subscription_id: sub.id,
    advanced_to: nextRunAtIso,
    force,
  });
}
