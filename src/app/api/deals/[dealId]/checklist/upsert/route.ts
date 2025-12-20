import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  checklistKey: string;
  title: string;
  description?: string | null;
  required?: boolean;
};

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;

  const checklistKey = (body?.checklistKey || "").trim();
  const title = (body?.title || "").trim();
  if (!checklistKey || !title) {
    return NextResponse.json({ ok: false, error: "Missing checklistKey/title" }, { status: 400 });
  }

  const required = body?.required ?? true;

  const { data, error } = await supabaseAdmin()
    .from("deal_checklist_items")
    .upsert(
      {
        deal_id: dealId,
        checklist_key: checklistKey,
        title,
        description: body?.description ?? null,
        required,
      },
      { onConflict: "deal_id,checklist_key" }
    )
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data?.id });
}
