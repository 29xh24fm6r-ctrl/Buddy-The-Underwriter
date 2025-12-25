// src/app/api/admin/pricing/policies/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin endpoint to manage pricing policies
 */
export async function GET(req: Request) {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("pricing_policies")
      .select("*")
      .order("effective_date", { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ ok: true, policies: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const sb = supabaseAdmin();
    const body = await req.json();

    const { data, error } = await sb
      .from("pricing_policies")
      .insert({
        name: String(body.name ?? "New Policy"),
        status: String(body.status ?? "draft"),
        effective_date: String(
          body.effectiveDate ?? new Date().toISOString().split("T")[0],
        ),
        notes: body.notes ? String(body.notes) : null,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, policy: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 400 });
  }
}
