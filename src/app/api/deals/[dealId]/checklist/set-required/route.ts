import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { checklistKey: string; required: boolean };

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const body = (await req.json().catch(() => null)) as Body | null;

    const checklistKey = (body?.checklistKey || "").trim();
    const required = !!body?.required;

    if (!checklistKey) {
      return NextResponse.json(
        { ok: false, error: "Missing checklistKey" },
        { status: 400 },
      );
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Tenant enforcement: ensure deal belongs to active bank.
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr) {
      return NextResponse.json({ ok: false, error: dealErr.message }, { status: 500 });
    }

    if (!deal) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    if (deal.bank_id !== bankId) {
      return NextResponse.json({ ok: false, error: "tenant_mismatch" }, { status: 403 });
    }

    // Fetch current value for audit.
    const { data: currentItem } = await sb
      .from("deal_checklist_items")
      .select("required")
      .eq("deal_id", dealId)
      .eq("checklist_key", checklistKey)
      .maybeSingle();

    const { error } = await sb
      .from("deal_checklist_items")
      .update({ required })
      .eq("deal_id", dealId)
      .eq("checklist_key", checklistKey);

    if (error) {
      console.error("[/api/deals/[dealId]/checklist/set-required]", error);
      return NextResponse.json({ ok: false, error: "Failed to set required" }, { status: 500 });
    }

    await writeEvent({
      dealId,
      kind: "checklist.required.set",
      actorUserId: userId,
      input: { checklistKey, required },
      meta: {
        checklist_key: checklistKey,
        previous_required: typeof currentItem?.required === "boolean" ? currentItem.required : null,
      },
    });

    return NextResponse.json({ ok: true, event_emitted: true });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist/set-required]", error);
    return NextResponse.json({ ok: false, error: "Failed to set required" }, { status: 500 });
  }
}
