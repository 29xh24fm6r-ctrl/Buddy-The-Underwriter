// src/app/api/admin/reminders/tick/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Canonical reminder tick with idempotency guard
 *
 * Writes ONLY columns that exist in deal_reminder_runs:
 * - subscription_id
 * - due_at
 * - ran_at
 * - status
 * - error
 * - meta
 */

type DueSubscriptionRow = {
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
  const sb = supabaseAdmin();

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
  const cadenceHoursFallback = Math.max(
    1,
    Math.min(24 * 30, Number(url.searchParams.get("cadenceHours") || 24))
  );

  const now = new Date();
  const nowIso = now.toISOString();

  // Idempotency guard: use advisory lock to prevent concurrent ticks
  const lockId = 1234567890; // Unique ID for reminder tick lock
  const { data: lockAcquired } = await sb.rpc("pg_try_advisory_lock", { lock_id: lockId });

  if (!lockAcquired) {
    return NextResponse.json({
      ok: false,
      error: "concurrent_tick_in_progress",
      message: "Another tick is already running. Try again in a few seconds.",
    });
  }

  try {
    // 1) Fetch due subscriptions (canonical only)
    const { data, error } = await sb
      .from("deal_reminder_subscriptions")
      .select("id, active, next_run_at, cadence_days, stop_after")
      .eq("active", true)
      .lte("next_run_at", nowIso)
      .order("next_run_at", { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "fetch_failed", detail: error.message },
        { status: 500 }
      );
    }

    const subs = (data ?? []) as DueSubscriptionRow[];

    let processed = 0;
    let deactivated = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const sub of subs) {
      const dueAtIso = sub.next_run_at ?? null;

      try {
        // 2) stop_after check
        if (sub.stop_after && new Date(sub.stop_after).getTime() <= now.getTime()) {
          const { error: deactErr } = await sb
            .from("deal_reminder_subscriptions")
            .update({ active: false })
            .eq("id", sub.id);

          if (deactErr) {
            await sb.from("deal_reminder_runs").insert({
              subscription_id: sub.id,
              due_at: dueAtIso,
              ran_at: nowIso,
              status: "error",
              error: `deactivate_failed: ${deactErr.message}`,
              meta: { stop_after: sub.stop_after },
            });
            throw deactErr;
          }

          await sb.from("deal_reminder_runs").insert({
            subscription_id: sub.id,
            due_at: dueAtIso,
            ran_at: nowIso,
            status: "skipped",
            error: "stop_after_reached",
            meta: { stop_after: sub.stop_after },
          });

          deactivated++;
          continue;
        }

        // 3) Compute cadence
        const cadenceMs =
          sub.cadence_days && sub.cadence_days > 0
            ? sub.cadence_days * 24 * 60 * 60 * 1000
            : cadenceHoursFallback * 60 * 60 * 1000;

        const nextRunAtIso = new Date(now.getTime() + cadenceMs).toISOString();

        // 4) Write run audit row (schema-exact)
        const run: ReminderRunInsert = {
          subscription_id: sub.id,
          due_at: dueAtIso,
          ran_at: nowIso,
          status: "sent",
          meta: {
            cadence_days: sub.cadence_days,
            cadenceHoursFallback,
            advanced_to: nextRunAtIso,
          },
        };

        const { error: runErr } = await sb.from("deal_reminder_runs").insert(run);
        if (runErr) throw runErr;

        // 5) Advance schedule
        const { error: upErr } = await sb
          .from("deal_reminder_subscriptions")
          .update({
            next_run_at: nextRunAtIso,
            last_sent_at: nowIso, // legacy but exists
          })
          .eq("id", sub.id);

        if (upErr) {
          await sb.from("deal_reminder_runs").insert({
            subscription_id: sub.id,
            due_at: dueAtIso,
            ran_at: nowIso,
            status: "error",
            error: `advance_failed: ${upErr.message}`,
            meta: { attempted_next: nextRunAtIso },
          });
          throw upErr;
        }

        processed++;
      } catch (e: any) {
        errors.push({
          id: sub.id,
          error: e?.message || "unknown_error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      due: subs.length,
      processed,
      deactivated,
      errors,
      now: nowIso,
      cadenceHoursFallback,
    });
  } finally {
    // Always release the lock
    await sb.rpc("pg_advisory_unlock", { lock_id: lockId });
  }
}
