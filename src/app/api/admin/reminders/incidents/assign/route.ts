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

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const id = String(body?.id || "");
  if (!id)
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 },
    );

  const owner_team =
    body?.owner_team === null
      ? null
      : String(body?.owner_team || "").trim() || null;
  const assigned_to =
    body?.assigned_to === null
      ? null
      : String(body?.assigned_to || "").trim() || null;
  const ack_required =
    body?.ack_required === undefined ? undefined : Boolean(body?.ack_required);

  const patch: any = {};
  if (body?.owner_team !== undefined) patch.owner_team = owner_team;
  if (body?.assigned_to !== undefined) patch.assigned_to = assigned_to;
  if (ack_required !== undefined) patch.ack_required = ack_required;

  const { error } = await sb.from("ops_incidents").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, error: "assign_failed", detail: error.message },
      { status: 500 },
    );
  }

  try {
    await sb.from("ops_incident_actions").insert({
      incident_id: id,
      source: "reminders",
      action: "assign",
      payload: { owner_team, assigned_to, ack_required },
    });
  } catch {}

  return NextResponse.json({ ok: true });
}
