import "server-only";

import { NextResponse } from "next/server";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  mustBuilderToken(req);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deals")
    .select("id, created_at, name")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "db_error", message: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json({ ok: false, error: "no_deals" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    dealId: data.id,
    createdAt: data.created_at,
    name: data.name ?? null,
  });
}
