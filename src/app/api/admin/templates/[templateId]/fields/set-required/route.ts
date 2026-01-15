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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ templateId: string }> },
) {
  try {
    await requireSuperAdmin();
    const { templateId } = await ctx.params;

    const body = await req.json().catch(() => ({}));
    const fieldName = String(body?.field_name ?? "");
    const required = Boolean(body?.required ?? false);

    if (!fieldName) {
      return NextResponse.json(
        { ok: false, error: "field_name is required" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    const { data, error } = (await (sb as any)
      .from("bank_document_template_fields")
      .update({ is_required: required })
      .eq("template_id", templateId)
      .eq("field_name", fieldName)
      .select("template_id, field_name, field_type, is_required, meta, created_at")
      .maybeSingle()) as any;

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "field_not_found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, field: data });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
