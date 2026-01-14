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

export async function POST(req: Request) {
  const auth = await enforceSuperAdmin();
  if (auth) return auth;

  const sb = supabaseAdmin();

  const url = new URL(req.url);
  const graceMin = Math.max(
    0,
    Math.min(60, Number(url.searchParams.get("graceMin") || 2)),
  );
  const cooldownMin = Math.max(
    1,
    Math.min(240, Number(url.searchParams.get("cooldownMin") || 15)),
  );
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") || 30)),
  );

  const now = new Date();
  const nowMs = now.getTime();
  const graceMs = graceMin * 60_000;
  const cooldownMs = cooldownMin * 60_000;

  const { data: rows, error } = await sb
    .from("ops_incidents")
    .select(
      "id,source,severity,status,ended_at,ack_required,acknowledged_at,notify_targets,last_notified_at,escalation_status,escalation_level,escalated_at",
    )
    .eq("source", "reminders")
    .eq("status", "open")
    .order("ended_at", { ascending: false })
    .limit(limit);

  if (error)
    return NextResponse.json(
      { ok: false, error: "fetch_failed", detail: error.message },
      { status: 500 },
    );

  const incidents = (rows ?? []) as any[];
  const escalated: any[] = [];
  const skipped: any[] = [];

  for (const inc of incidents) {
    const endedAtMs = new Date(String(inc.ended_at)).getTime();
    const ageMs = nowMs - endedAtMs;

    const sev1 = String(inc.severity) === "SEV-1";
    const needsAck = Boolean(inc.ack_required) || sev1;
    const isAcked = Boolean(inc.acknowledged_at);

    if (!needsAck || isAcked) {
      skipped.push({
        id: inc.id,
        reason: !needsAck ? "no_ack_required" : "acked",
      });
      continue;
    }
    if (ageMs < graceMs) {
      skipped.push({ id: inc.id, reason: "within_grace" });
      continue;
    }

    const lastNotifiedAt = inc.last_notified_at
      ? new Date(String(inc.last_notified_at)).getTime()
      : null;
    if (lastNotifiedAt !== null && nowMs - lastNotifiedAt < cooldownMs) {
      skipped.push({ id: inc.id, reason: "cooldown" });
      continue;
    }

    const targets: string[] = Array.isArray(inc.notify_targets)
      ? inc.notify_targets.map(String)
      : [];
    const effectiveTargets = targets.length ? targets : ["slack:#ops"];

    const subject = `[${inc.source}] ${inc.severity} incident requires ACK (${inc.id})`;
    const body = [
      `Incident: ${inc.id}`,
      `Severity: ${inc.severity}`,
      `Status: open (needs ACK)`,
      `Ended: ${inc.ended_at}`,
      ``,
      `War Room: /ops/reminders/war-room?mode=movie`,
      `Actions: ack / notes / mute / force-run`,
    ].join("\n");

    for (const t of effectiveTargets) {
      const [type, target] = t.includes(":") ? t.split(":") : ["slack", t];
      try {
        await sb.from("ops_notification_outbox").insert({
          source: "reminders",
          type,
          target,
          subject,
          body,
          payload: { incident_id: inc.id, severity: inc.severity },
        });
      } catch {}
    }

    const nowIso = now.toISOString();
    await sb
      .from("ops_incidents")
      .update({
        escalation_status: "sent",
        escalation_level: inc.severity,
        escalated_at: inc.escalated_at ?? nowIso,
        last_notified_at: nowIso,
        notify_targets: effectiveTargets,
      })
      .eq("id", inc.id);

    try {
      await sb.from("ops_incident_actions").insert({
        incident_id: inc.id,
        source: "reminders",
        action: "auto_escalate",
        payload: { graceMin, cooldownMin, targets: effectiveTargets },
      });
    } catch {}

    escalated.push({ id: inc.id, targets: effectiveTargets });
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    graceMin,
    cooldownMin,
    evaluated: incidents.length,
    escalatedCount: escalated.length,
    escalated,
    skippedCount: skipped.length,
    skipped,
  });
}
