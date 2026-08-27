// src/app/api/admin/reminders/incidents/notes/route.ts
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
