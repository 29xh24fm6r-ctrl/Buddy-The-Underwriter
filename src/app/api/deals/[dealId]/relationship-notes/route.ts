import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deals")
    .select("banker_relationship_notes")
    .eq("id", dealId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    banker_relationship_notes: (data as any)?.banker_relationship_notes ?? "",
  });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const notes = typeof body.banker_relationship_notes === "string"
    ? body.banker_relationship_notes
    : null;

  if (notes === null) {
    return NextResponse.json(
      { ok: false, error: "banker_relationship_notes is required" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("deals")
    .update({ banker_relationship_notes: notes } as any)
    .eq("id", dealId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
