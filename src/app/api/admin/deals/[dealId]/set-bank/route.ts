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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    await requireSuperAdmin();
    const { dealId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const bank_id = String(body?.bank_id ?? "");

    if (!bank_id) {
      return NextResponse.json(
        { ok: false, error: "bank_id is required" },
        { status: 400 },
      );
    }

    const supabase = supabaseAdmin();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("deal_bank_links")
      .upsert({ deal_id: dealId, bank_id, updated_at: now } as any, {
        onConflict: "deal_id",
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, link: data });
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
