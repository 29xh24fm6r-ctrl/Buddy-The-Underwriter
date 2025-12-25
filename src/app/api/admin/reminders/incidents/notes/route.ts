// src/app/api/admin/reminders/incidents/notes/route.ts
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
  const notes = body?.notes === null ? null : String(body?.notes || "");

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400 },
    );
  }

  const { error } = await sb
    .from("ops_incidents")
    .update({ notes })
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { ok: false, error: "notes_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
