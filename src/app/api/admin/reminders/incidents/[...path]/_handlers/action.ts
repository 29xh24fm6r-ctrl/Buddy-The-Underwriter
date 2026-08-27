// src/app/api/admin/reminders/incidents/action/route.ts
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

type Action = "mute" | "force_run";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function auditAction(
  sb: any,
  incidentId: string | null,
  action: Action,
  payload: any,
) {
  if (!incidentId) return;

  const nowIso = new Date().toISOString();

  // best-effort insert audit log
  try {
    await sb.from("ops_incident_actions").insert({
      incident_id: incidentId,
      source: "reminders",
      action,
      payload: payload ?? {},
    });
  } catch {
    // ignore
  }

  // best-effort update incident summary
  try {
    await sb
      .from("ops_incidents")
      .update({ last_action_at: nowIso, last_action: action })
      .eq("id", incidentId);
  } catch {
    // ignore
  }
}

export async function POST(req: Request) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const sb = supabaseAdmin();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const incidentId = body?.incident_id ? String(body.incident_id) : null;
  const action = String(body?.action || "") as Action;
  const subscriptionIdsRaw = Array.isArray(body?.subscription_ids)
    ? body.subscription_ids
    : [];
  const subscriptionIds = subscriptionIdsRaw
    .map((x: any) => String(x))
    .filter(Boolean);

  const concurrency = Math.max(1, Math.min(5, Number(body?.concurrency || 3)));
  const throttleMs = Math.max(
    0,
    Math.min(500, Number(body?.throttle_ms || 120)),
  );

  if (!["mute", "force_run"].includes(action)) {
    return NextResponse.json(
      { ok: false, error: "invalid_action" },
      { status: 400 },
    );
  }
  if (subscriptionIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_subscription_ids" },
      { status: 400 },
    );
  }
  if (subscriptionIds.length > 50) {
    return NextResponse.json(
      { ok: false, error: "too_many_subscription_ids", max: 50 },
      { status: 400 },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "mute") {
    const { data, error } = await sb
      .from("deal_reminder_subscriptions")
      .update({ active: false })
      .in("id", subscriptionIds)
      .select("id");

    if (error) {
      await auditAction(sb, incidentId, action, {
        ok: false,
        error: error.message,
        count: subscriptionIds.length,
      });
      return NextResponse.json(
        { ok: false, error: "mute_failed", detail: error.message },
        { status: 500 },
      );
    }

    // Best-effort: insert audit runs
    try {
      await sb.from("deal_reminder_runs").insert(
        subscriptionIds.map((id: string) => ({
          subscription_id: id,
          due_at: null,
          ran_at: nowIso,
          status: "skipped",
          error: "muted_by_ops",
          meta: {
            bulk: true,
            action: "mute",
            at: nowIso,
            incident_id: incidentId,
          },
        })),
      );
    } catch {
      // ignore
    }

    await auditAction(sb, incidentId, action, {
      ok: true,
      updated: (data ?? []).length,
      requested: subscriptionIds.length,
    });

    return NextResponse.json({
      ok: true,
      action,
      requested: subscriptionIds.length,
      updated: (data ?? []).length,
    });
  }

  // FORCE_RUN is paced and safe: per subscription select + advance + insert run
  // We throttle and keep concurrency low to avoid spiking DB.
  const results: Array<{
    subscription_id: string;
    ok: boolean;
    status?: string;
    error?: string;
  }> = [];

  // Worker that runs one subscription at a time
  async function runOne(subscriptionId: string) {
    try {
      // Fetch canonical fields (avoid guessing columns)
      const subRes = await sb
        .from("deal_reminder_subscriptions")
        .select("id,active,next_run_at,cadence_days,stop_after")
        .eq("id", subscriptionId)
        .limit(1)
        .maybeSingle();

      if (subRes.error) {
        results.push({
          subscription_id: subscriptionId,
          ok: false,
          error: subRes.error.message,
        });
        return;
      }
      if (!subRes.data) {
        results.push({
          subscription_id: subscriptionId,
          ok: false,
          error: "not_found",
        });
        return;
      }

      const sub = subRes.data as {
        id: string;
        active: boolean;
        next_run_at: string;
        cadence_days: number | null;
        stop_after: string | null;
      };

      // If inactive, record skip
      if (!sub.active) {
        try {
          await sb.from("deal_reminder_runs").insert({
            subscription_id: sub.id,
            due_at: sub.next_run_at ?? null,
            ran_at: nowIso,
            status: "skipped",
            error: "inactive",
            meta: {
              bulk: true,
              action: "force_run",
              at: nowIso,
              incident_id: incidentId,
            },
          });
        } catch {}
        results.push({
          subscription_id: subscriptionId,
          ok: true,
          status: "skipped_inactive",
        });
        return;
      }

      // If stop_after passed, deactivate + record skip
      if (
        sub.stop_after &&
        new Date(sub.stop_after).getTime() <= now.getTime()
      ) {
        await sb
          .from("deal_reminder_subscriptions")
          .update({ active: false })
          .eq("id", sub.id);
        try {
          await sb.from("deal_reminder_runs").insert({
            subscription_id: sub.id,
            due_at: sub.next_run_at ?? null,
            ran_at: nowIso,
            status: "skipped",
            error: "stop_after_reached",
            meta: {
              bulk: true,
              action: "force_run",
              at: nowIso,
              incident_id: incidentId,
              stop_after: sub.stop_after,
            },
          });
        } catch {}
        results.push({
          subscription_id: subscriptionId,
          ok: true,
          status: "skipped_stop_after",
        });
        return;
      }

      // Compute next_run_at
      const cadenceHoursFallback = 24;
      const cadenceMs =
        sub.cadence_days && Number(sub.cadence_days) > 0
          ? Number(sub.cadence_days) * 24 * 60 * 60 * 1000
          : cadenceHoursFallback * 60 * 60 * 1000;

      const nextRunAtIso = new Date(now.getTime() + cadenceMs).toISOString();

      // Advance schedule (force semantics: update without "next_run_at = old" constraint)
      const up = await sb
        .from("deal_reminder_subscriptions")
        .update({ next_run_at: nextRunAtIso, last_sent_at: nowIso })
        .eq("id", sub.id)
        .eq("active", true);

      if (up.error) {
        try {
          await sb.from("deal_reminder_runs").insert({
            subscription_id: sub.id,
            due_at: sub.next_run_at ?? null,
            ran_at: nowIso,
            status: "error",
            error: `advance_failed: ${up.error.message}`,
            meta: {
              bulk: true,
              action: "force_run",
              at: nowIso,
              incident_id: incidentId,
              attempted_next: nextRunAtIso,
            },
          });
        } catch {}
        results.push({
          subscription_id: subscriptionId,
          ok: false,
          error: up.error.message,
        });
        return;
      }

      // Insert run audit (best effort)
      try {
        await sb.from("deal_reminder_runs").insert({
          subscription_id: sub.id,
          due_at: sub.next_run_at ?? null,
          ran_at: nowIso,
          status: "sent",
          meta: {
            bulk: true,
            action: "force_run",
            at: nowIso,
            incident_id: incidentId,
            advanced_to: nextRunAtIso,
          },
        });
      } catch {
        // ignore
      }

      results.push({
        subscription_id: subscriptionId,
        ok: true,
        status: "sent",
      });
    } catch (e: any) {
      results.push({
        subscription_id: subscriptionId,
        ok: false,
        error: e?.message || "unknown",
      });
    }
  }

  // Simple concurrency pool
  const queue = [...subscriptionIds];
  const workers = Array.from({ length: concurrency }).map(async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      await runOne(id);
      if (throttleMs) await sleep(throttleMs);
    }
  });

  await Promise.all(workers);

  const okCount = results.filter((r) => r.ok).length;

  await auditAction(sb, incidentId, action, {
    ok: true,
    requested: subscriptionIds.length,
    okCount,
    results,
  });

  return NextResponse.json({
    ok: true,
    action,
    requested: subscriptionIds.length,
    okCount,
    results,
  });
}
