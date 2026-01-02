import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  checklistKey: string;
  title: string;
  description?: string | null;
  required?: boolean;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await clerkAuth();
    if (!userId)
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );

    const { dealId } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Body | null;

    const checklistKey = (body?.checklistKey || "").trim();
    const title = (body?.title || "").trim();
    if (!checklistKey || !title) {
      return NextResponse.json(
        { ok: false, error: "Missing checklistKey/title" },
        { status: 400 },
      );
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
        { onConflict: "deal_id,checklist_key" },
      )
      .select("id")
      .single();

    if (error) {
      console.error("[/api/deals/[dealId]/checklist/upsert]", error);
      return NextResponse.json({
        ok: false,
        error: "Failed to upsert checklist item",
      });
    }

    // Emit ledger event
    await writeEvent({
      dealId,
      kind: "checklist.item.upserted",
      actorUserId: userId,
      input: { checklistKey, title, required },
      meta: { checklist_key: checklistKey, item_id: data?.id },
    });

    return NextResponse.json({ ok: true, id: data?.id, event_emitted: true });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist/upsert]", error);
    return NextResponse.json({
      ok: false,
      error: "Failed to upsert checklist item",
    });
  }
}
