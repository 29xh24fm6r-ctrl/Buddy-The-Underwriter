import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUSES = ["missing", "received", "waived", "pending", "optional", "in_review", "needs_review"] as const;
type Status = typeof ALLOWED_STATUSES[number];
type Body = { checklistKey: string; status: Status };

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

    // Tenant gate
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error === "unauthorized" ? "Unauthorized" : "Deal not found" },
        { status: access.error === "unauthorized" ? 401 : 404 },
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    const checklistKey = (body?.checklistKey || "").trim();
    const status = body?.status;

    if (!checklistKey || !status) {
      return NextResponse.json(
        { ok: false, error: "Missing checklistKey/status" },
        { status: 400 },
      );
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status" },
        { status: 400 },
      );
    }

    // Fetch current status before update
    const { data: currentItem } = await supabaseAdmin()
      .from("deal_checklist_items")
      .select("status")
      .eq("deal_id", dealId)
      .eq("checklist_key", checklistKey)
      .single();

    const patch: any = { status };
    if (status === "received") patch.received_at = new Date().toISOString();
    if (status !== "received") {
      patch.received_at = null;
      patch.received_file_id = null;
    }

    const { error } = await supabaseAdmin()
      .from("deal_checklist_items")
      .update(patch)
      .eq("deal_id", dealId)
      .eq("checklist_key", checklistKey);

    if (error) {
      console.error("[/api/deals/[dealId]/checklist/set-status]", error);
      return NextResponse.json({
        ok: false,
        error: "Failed to set status",
      });
    }

    // Emit ledger event
    await writeEvent({
      dealId,
      kind: "checklist.status.set",
      actorUserId: userId,
      input: { checklistKey, status },
      meta: {
        previous_status: currentItem?.status || null,
        checklist_key: checklistKey,
      },
    });

    return NextResponse.json({ ok: true, event_emitted: true });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/checklist/set-status]", error);
    return NextResponse.json({
      ok: false,
      error: "Failed to set status",
    });
  }
}
