// src/app/api/banks/[bankId]/templates/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("borrower_request_templates")
    .select("id, bank_id, title, category, description, doc_type, year_mode, sort_order, active, created_at, updated_at")
    .eq("bank_id", bankId)
    .order("active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, templates: data || [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));

  const title = String(body?.title || "").trim();
  if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });

  const category = body?.category ? String(body.category).trim() : null;
  const description = body?.description ? String(body.description).trim() : null;
  const doc_type = body?.doc_type ? String(body.doc_type).trim() : null;

  const year_modeRaw = body?.year_mode ? String(body.year_mode).trim() : "optional";
  const year_mode = ["optional", "required", "forbidden"].includes(year_modeRaw) ? year_modeRaw : "optional";

  const sort_order = Number.isFinite(Number(body?.sort_order)) ? Number(body.sort_order) : 0;
  const active = typeof body?.active === "boolean" ? body.active : true;

  const { data, error } = await sb
    .from("borrower_request_templates")
    .insert({
      bank_id: bankId,
      title,
      category,
      description,
      doc_type,
      year_mode,
      sort_order,
      active,
      updated_at: new Date().toISOString(),
    })
    .select("id, bank_id, title, category, description, doc_type, year_mode, sort_order, active, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, template: data });
}
