// src/app/api/admin/reminders/incidents/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Severity = "SEV-1" | "SEV-2" | "SEV-3";
type IncidentPayload = {
  id: string;
  source?: string; // default reminders
  severity: Severity;
  status: "open" | "resolved";
  started_at: string;
  ended_at: string;
  resolved_at: string | null;
  error_count: number;
  unique_subscriptions: number;
  subscription_ids: string[]; // uuid strings
  latest_run_id: string | null; // uuid
  latest_error: string | null;
};

export async function POST(req: Request) {
  const sb = supabaseAdmin();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const incidents: IncidentPayload[] = Array.isArray(body?.incidents)
    ? body.incidents
    : [];
  if (incidents.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_incidents" },
      { status: 400 },
    );
  }
  if (incidents.length > 200) {
    return NextResponse.json(
      { ok: false, error: "too_many_incidents", max: 200 },
      { status: 400 },
    );
  }

  const rows = incidents.map((i) => ({
    id: String(i.id),
    source: String(i.source || "reminders"),
    severity: i.severity,
    status: i.status,
    started_at: i.started_at,
    ended_at: i.ended_at,
    resolved_at: i.resolved_at,
    error_count: Number(i.error_count || 0),
    unique_subscriptions: Number(i.unique_subscriptions || 0),
    subscription_ids: (i.subscription_ids || []).map((x) => String(x)),
    latest_run_id: i.latest_run_id ? String(i.latest_run_id) : null,
    latest_error: i.latest_error ? String(i.latest_error) : null,
  }));

  const { error } = await sb
    .from("ops_incidents")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "upsert_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, upserted: rows.length });
}
