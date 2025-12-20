// src/app/api/banker/deals/[dealId]/next-actions/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

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
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    requireUserId(req);
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;
    const body = await req.json();

    // { id, status: "open"|"done" }
    const id = String(body?.id ?? "");
    const status = String(body?.status ?? "");
    if (!id) throw new Error("Missing id.");
    if (status !== "open" && status !== "done") throw new Error("Invalid status.");

    const { error } = await sb
      .from("deal_next_actions")
      .update({ status })
      .eq("id", id)
      .eq("deal_id", dealId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
