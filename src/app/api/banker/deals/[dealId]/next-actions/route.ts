// src/app/api/banker/deals/[dealId]/next-actions/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function accessStatus(error: string): number {
  return error === "deal_not_found" ? 404 : error === "tenant_mismatch" ? 403 : 401;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    // Real tenant/deal-access check — the old x-user-id header was spoofable and
    // let any caller read another bank's deal_next_actions.
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: accessStatus(access.error) },
      );
    }
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deal_next_actions")
      .select("*")
      .eq("deal_id", dealId)
      .eq("visibility", "banker")
      .order("status", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    return NextResponse.json({ ok: true, actions: data ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: accessStatus(access.error) },
      );
    }
    const sb = supabaseAdmin();
    const body = await req.json();

    // { id, status: "open"|"done" }
    const id = String(body?.id ?? "");
    const status = String(body?.status ?? "");
    if (!id) throw new Error("Missing id.");
    if (status !== "open" && status !== "done")
      throw new Error("Invalid status.");

    const { error } = await sb
      .from("deal_next_actions")
      .update({ status })
      .eq("id", id)
      .eq("deal_id", dealId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
