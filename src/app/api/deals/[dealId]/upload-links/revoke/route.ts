import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { id: string };

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;

  const id = body?.id || "";
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from("deal_upload_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("deal_id", dealId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
