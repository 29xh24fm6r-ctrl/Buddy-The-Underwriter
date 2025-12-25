// src/app/api/banks/[bankId]/templates/[templateId]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ bankId: string; templateId: string }> },
) {
  const { bankId, templateId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const patch: any = { updated_at: new Date().toISOString() };

  if (body?.title != null) {
    const title = String(body.title).trim();
    if (!title)
      return NextResponse.json(
        { error: "title cannot be empty" },
        { status: 400 },
      );
    patch.title = title;
  }
  if (body?.category !== undefined)
    patch.category = body.category ? String(body.category).trim() : null;
  if (body?.description !== undefined)
    patch.description = body.description
      ? String(body.description).trim()
      : null;
  if (body?.doc_type !== undefined)
    patch.doc_type = body.doc_type ? String(body.doc_type).trim() : null;

  if (body?.year_mode != null) {
    const ym = String(body.year_mode).trim();
    if (!["optional", "required", "forbidden"].includes(ym)) {
      return NextResponse.json(
        { error: "year_mode must be optional|required|forbidden" },
        { status: 400 },
      );
    }
    patch.year_mode = ym;
  }

  if (body?.sort_order != null)
    patch.sort_order = Number.isFinite(Number(body.sort_order))
      ? Number(body.sort_order)
      : 0;
  if (body?.active != null) patch.active = !!body.active;

  const { data, error } = await sb
    .from("borrower_request_templates")
    .update(patch)
    .eq("id", templateId)
    .eq("bank_id", bankId)
    .select(
      "id, bank_id, title, category, description, doc_type, year_mode, sort_order, active, created_at, updated_at",
    )
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, template: data });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ bankId: string; templateId: string }> },
) {
  const { bankId, templateId } = await ctx.params;
  const sb = supabaseAdmin();

  const { error } = await sb
    .from("borrower_request_templates")
    .delete()
    .eq("id", templateId)
    .eq("bank_id", bankId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
