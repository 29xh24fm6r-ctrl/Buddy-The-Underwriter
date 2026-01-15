import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ bankId: string }> },
) {
  try {
    await requireSuperAdmin();

    const { bankId } = await ctx.params;
    const url = new URL(req.url);
    const templateId = url.searchParams.get("templateId");

    const sb = supabaseAdmin();

    const { data: templates, error: tErr } = (await (sb as any)
      .from("bank_document_templates")
      .select("id, bank_id, template_key, version, name, created_at")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })) as any;

    if (tErr) throw tErr;

    const templateIds = (templates ?? [])
      .map((t: any) => String(t.id))
      .filter(Boolean);

    const filteredTemplateIds = templateId
      ? templateIds.filter((id: string) => id === templateId)
      : templateIds;

    if (filteredTemplateIds.length === 0) {
      return NextResponse.json({ ok: true, templates: templates ?? [], fields: [] });
    }

    const { data: fields, error: fErr } = (await (sb as any)
      .from("bank_document_template_fields")
      .select("template_id, field_name, field_type, is_required, meta, created_at")
      .in("template_id", filteredTemplateIds)
      .order("template_id", { ascending: true })
      .order("field_name", { ascending: true })) as any;

    if (fErr) throw fErr;

    const { data: maps, error: mErr } = (await (sb as any)
      .from("bank_template_field_maps")
      .select("template_id, pdf_field")
      .in("template_id", filteredTemplateIds)) as any;

    if (mErr) throw mErr;

    const mappedByTemplate = new Map<string, Set<string>>();
    for (const r of maps ?? []) {
      const tid = String(r.template_id ?? "");
      const pdf = String(r.pdf_field ?? "");
      if (!tid || !pdf) continue;
      if (!mappedByTemplate.has(tid)) mappedByTemplate.set(tid, new Set());
      mappedByTemplate.get(tid)!.add(pdf);
    }

    const templatesById = new Map<string, any>();
    for (const t of templates ?? []) templatesById.set(String(t.id), t);

    const rows = (fields ?? []).map((f: any) => {
      const tid = String(f.template_id ?? "");
      const t = templatesById.get(tid) ?? null;
      const mappedSet = mappedByTemplate.get(tid) ?? new Set<string>();
      const fieldName = String(f.field_name ?? "");

      return {
        template_id: tid,
        template_key: t?.template_key ?? null,
        template_version: t?.version ?? null,
        template_name: t?.name ?? null,
        field_name: fieldName,
        field_type: f.field_type ?? null,
        is_required: Boolean(f.is_required ?? false),
        mapped: mappedSet.has(fieldName),
        meta: f.meta ?? {},
        created_at: f.created_at ?? null,
      };
    });

    return NextResponse.json({ ok: true, templates: templates ?? [], fields: rows });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
