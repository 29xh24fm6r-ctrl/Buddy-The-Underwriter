import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized") return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden") return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  try {
    requireSuperAdmin();
    const { templateId } = await ctx.params;

    const { data, error } = await supabaseAdmin()
      .from("bank_template_field_maps")
      .select("*")
      .eq("template_id", templateId)
      .order("created_at", { ascending: true }) as any;

    if (error) throw error;
    return NextResponse.json({ ok: true, maps: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  try {
    requireSuperAdmin();
    const { templateId } = await ctx.params;
    const body = await req.json();

    const canonical_field = String(body?.canonical_field ?? "");
    const pdf_field = String(body?.pdf_field ?? "");
    const transform = body?.transform ?? null;
    const required = Boolean(body?.required ?? false);

    if (!canonical_field || !pdf_field) {
      return NextResponse.json({ ok: false, error: "canonical_field and pdf_field are required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from("bank_template_field_maps")
      .upsert(
        { template_id: templateId, canonical_field, pdf_field, transform, required } as any,
        { onConflict: "template_id,canonical_field,pdf_field" }
      )
      .select("*")
      .single() as any;

    if (error) throw error;
    return NextResponse.json({ ok: true, map: data });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  try {
    requireSuperAdmin();
    const { templateId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });

    const { error } = await supabaseAdmin()
      .from("bank_template_field_maps")
      .delete()
      .eq("id", id)
      .eq("template_id", templateId) as any;

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
