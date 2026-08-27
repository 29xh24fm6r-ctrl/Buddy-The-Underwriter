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

function fmt(ts: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString();
  } catch {
    return ts;
  }
}

function mdEscape(s: string) {
  return (s || "").replace(/\r/g, "").trim();
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

  const id = String(body?.id || "");
  const publish = Boolean(body?.publish || false);

  if (!id)
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 },
    );

  const incRes = await sb
    .from("ops_incidents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (incRes.error)
    return NextResponse.json(
      {
        ok: false,
        error: "incident_fetch_failed",
        detail: incRes.error.message,
      },
      { status: 500 },
    );
  if (!incRes.data)
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404 },
    );

  const inc = incRes.data as any;

  const actionsRes = await sb
    .from("ops_incident_actions")
    .select("action, payload, created_at")
    .eq("incident_id", id)
    .order("created_at", { ascending: true });

  const actions = (actionsRes.data ?? []) as any[];

  const subs: string[] = Array.isArray(inc.subscription_ids)
    ? inc.subscription_ids.map(String)
    : [];
  const startedAt = String(inc.started_at);
  const endedAt = String(inc.ended_at);

  let runs: any[] = [];
  if (subs.length) {
    const runsRes = await sb
      .from("deal_reminder_runs")
      .select("id, subscription_id, ran_at, status, error, meta")
      .in("subscription_id", subs)
      .gte("ran_at", startedAt)
      .lte("ran_at", endedAt)
      .order("ran_at", { ascending: true })
      .limit(500);

    runs = (runsRes.data ?? []) as any[];
  }

  const topErrors = runs
    .filter((r) => r.status === "error")
    .map((r) => String(r.error || "").trim())
    .filter(Boolean)
    .slice(0, 10);

  const targets: string[] = Array.isArray(inc.notify_targets)
    ? inc.notify_targets.map(String)
    : [];

  const md = [
    `# Incident Postmortem — ${inc.source || "reminders"} — ${inc.severity} — ${inc.status}`,
    ``,
    `**Incident ID:** \`${id}\``,
    `**Window:** ${fmt(startedAt)} → ${fmt(endedAt)}`,
    `**Resolved At:** ${fmt(inc.resolved_at)}`,
    `**Error Count:** ${inc.error_count ?? "—"}  |  **Unique Subs:** ${inc.unique_subscriptions ?? "—"}`,
    `**Owner Team:** ${inc.owner_team || "—"}  |  **Assigned To:** ${inc.assigned_to || "—"}`,
    `**Ack Required:** ${inc.ack_required ? "yes" : "no"}  |  **Acknowledged At:** ${fmt(inc.acknowledged_at)}`,
    `**Escalation:** ${inc.escalation_status || "none"} ${inc.escalation_level ? `(${inc.escalation_level})` : ""}  |  **Targets:** ${targets.length ? targets.join(", ") : "—"}`,
    ``,
    `## Summary`,
    mdEscape(inc.latest_error || "Describe what happened in one paragraph."),
    ``,
    `## Impact`,
    `- Who/what was impacted?`,
    `- What user-visible behavior occurred?`,
    ``,
    `## Timeline (audit/actions)`,
    actions.length
      ? actions
          .map(
            (a) =>
              `- ${fmt(a.created_at)} — **${a.action}** — \`${JSON.stringify(a.payload ?? {})}\``,
          )
          .join("\n")
      : `- (no actions recorded)`,
    ``,
    `## Signals / Errors (sample)`,
    topErrors.length
      ? topErrors.map((e) => `- ${mdEscape(e)}`).join("\n")
      : `- (no error messages captured)`,
    ``,
    `## Root Cause`,
    `- (fill in)`,
    ``,
    `## Remediation`,
    `- (what was done during incident)`,
    ``,
    `## Prevention / Follow-ups`,
    `- [ ] Add guard / test / alert`,
    `- [ ] Improve error classification`,
    `- [ ] Add runbook steps`,
    ``,
    `---`,
    `Generated: ${new Date().toISOString()}`,
  ].join("\n");

  const nowIso = new Date().toISOString();
  const patch: any = {
    postmortem_md: md,
    postmortem_status: publish ? "published" : "draft",
    postmortem_created_at: inc.postmortem_created_at ?? nowIso,
  };
  if (publish) patch.postmortem_published_at = nowIso;

  const up = await sb.from("ops_incidents").update(patch).eq("id", id);
  if (up.error)
    return NextResponse.json(
      { ok: false, error: "postmortem_save_failed", detail: up.error.message },
      { status: 500 },
    );

  try {
    await sb.from("ops_incident_actions").insert({
      incident_id: id,
      source: "reminders",
      action: publish ? "postmortem_publish" : "postmortem_generate",
      payload: { publish },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    markdown: md,
    status: patch.postmortem_status,
  });
}
