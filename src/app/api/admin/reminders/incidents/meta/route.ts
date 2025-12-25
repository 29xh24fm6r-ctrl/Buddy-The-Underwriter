// src/app/api/admin/reminders/incidents/meta/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = supabaseAdmin();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.map((x: any) => String(x))
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: "missing_ids" },
      { status: 400 },
    );
  }
  if (ids.length > 200) {
    return NextResponse.json(
      { ok: false, error: "too_many_ids", max: 200 },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from("ops_incidents")
    .select(
      [
        "id",
        "status",
        "severity",
        "resolved_at",
        "acknowledged_at",
        "acknowledged_by",
        "notes",
        "last_action_at",
        "last_action",
        // v2
        "owner_team",
        "assigned_to",
        "ack_required",
        "postmortem_status",
        "postmortem_created_at",
        "postmortem_published_at",
        "postmortem_md",
        "escalation_status",
        "escalation_level",
        "escalated_at",
        "last_notified_at",
        "notify_targets",
      ].join(","),
    )
    .in("id", ids);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "fetch_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, meta: data ?? [] });
}
