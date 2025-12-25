// src/app/api/admin/reminders/incidents/ack/route.ts
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

  const id = String(body?.id || "");
  const ack = Boolean(body?.ack);

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 },
    );
  }

  const patch = ack
    ? { acknowledged_at: new Date().toISOString() }
    : { acknowledged_at: null, acknowledged_by: null };

  const { error } = await sb.from("ops_incidents").update(patch).eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, error: "ack_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
