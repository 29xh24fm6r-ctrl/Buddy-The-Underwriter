import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

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
  _req: NextRequest,
  ctx: { params: Promise<{ bankId: string }> },
) {
  try {
    requireSuperAdmin();
    const { bankId } = await ctx.params;

    const { data: templates, error: e1 } = (await supabaseAdmin()
      .from("bank_document_templates")
      .select("*")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })) as any;

    if (e1) throw e1;

    return NextResponse.json({ ok: true, templates: templates ?? [] });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
